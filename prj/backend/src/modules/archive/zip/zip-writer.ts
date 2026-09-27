import { Readable, type Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { createDeflateRaw, type ZlibOptions } from 'node:zlib';

import { Crc32 } from './crc32.js';
import { toDosDateTime } from './dos-time.js';
import { ZipError } from './zip-error.js';
import { normalizeEntryName } from './zip-name.js';
import {
  CENTRAL_HEADER_SIZE,
  DOS_DIRECTORY,
  EOCD_SIZE,
  EXTRA_EXTENDED_TIMESTAMP,
  EXTRA_ZIP64,
  FLAG_DATA_DESCRIPTOR,
  FLAG_UTF8,
  LOCAL_HEADER_SIZE,
  MAX_UINT16,
  MAX_UINT32,
  METHOD_DEFLATE,
  METHOD_STORE,
  SIG_CENTRAL_HEADER,
  SIG_DATA_DESCRIPTOR,
  SIG_EOCD,
  SIG_LOCAL_HEADER,
  SIG_ZIP64_EOCD,
  SIG_ZIP64_LOCATOR,
  S_IFDIR,
  S_IFLNK,
  S_IFREG,
  VERSION_DEFAULT,
  VERSION_MADE_BY,
  VERSION_ZIP64,
  ZIP64_EOCD_SIZE,
  ZIP64_LOCATOR_SIZE,
} from './zip.constants.js';

/**
 * The largest size hint that still lets an entry go without a ZIP64 local
 * header. Deflate can *grow* incompressible data — by a few bytes per 16 KiB
 * block — so the margin under 4 GiB is what keeps the compressed size of a
 * file just under the limit from overflowing a 32-bit field after the fact.
 */
const SMALL_ENTRY_LIMIT = 0xf000_0000;

/** Central directory records are gathered into writes of about this size, not one tiny write each. */
const CENTRAL_DIRECTORY_BATCH = 64 * 1024;

const EMPTY = Buffer.alloc(0);

export interface ZipWriterOptions {
  /**
   * Write every ZIP64 structure — local extra fields, central extra fields,
   * the ZIP64 end records — even when nothing needs them. For tests, which
   * cannot afford a 4 GiB archive to reach that code.
   */
  readonly forceZip64?: boolean;
  /** Deflate level, 0–9; zlib's default (6) when left out. */
  readonly level?: number;
}

export interface ZipFileOptions {
  readonly mtime: Date;
  /** Permission bits (type bits are ignored); 0o644 when left out. */
  readonly mode?: number;
  /**
   * The size the caller expects, from a `stat`. Only a hint: with one under
   * about 3.75 GiB the entry is written without ZIP64 fields, which the
   * oldest readers need; without one, ZIP64 is assumed, as the size can be
   * anything. Data that outgrows a small hint past 4 GiB fails the entry.
   */
  readonly size?: number;
  /** `store` for data that is already compressed (images, video, archives); `deflate` by default. */
  readonly method?: 'deflate' | 'store';
  /** Aborting rejects with an `AbortError`, destroys `source`, and leaves the writer unusable. */
  readonly signal?: AbortSignal;
  /** Called with each chunk's length in *uncompressed* bytes read from `source`, for progress. */
  readonly onBytes?: (bytes: number) => void;
}

/** What the central directory needs to know about an entry already written. */
interface EntryRecord {
  readonly name: Buffer;
  readonly flags: number;
  readonly method: number;
  readonly dosDate: number;
  readonly dosTime: number;
  /** Seconds since the epoch, when an extended timestamp can hold it. */
  readonly unixTime: number | null;
  readonly externalAttributes: number;
  /** Where the local header starts. */
  readonly offset: number;
  /** The local header carries a ZIP64 extra field, so the data descriptor has 8-byte sizes. */
  readonly zip64Local: boolean;
  crc: number;
  compressedSize: number;
  size: number;
}

/**
 * Writes a ZIP archive to a `Writable` as it goes: an entry's bytes pass from
 * its source through deflate to the output a chunk at a time, and only the
 * central directory — some 100 bytes an entry — is kept until `finish`.
 *
 * Nothing about a file is known before it has been read, so file entries set
 * flag bit 3: the local header says "sizes and CRC follow the data", and a
 * data descriptor after the data gives them. For the same reason a file's
 * local header carries a ZIP64 extra field unless a size hint rules out
 * 4 GiB — the spec lets a data descriptor have 8-byte sizes only when the
 * local header announced ZIP64, and by the time the size is known the header
 * has long been sent.
 *
 * Calls may be made without awaiting the previous one; they are queued and
 * run one after another, as entries cannot interleave. Once an entry fails
 * after its first byte reached the output, the archive is broken and every
 * later call rejects: the caller should discard what was written.
 */
export class ZipWriter {
  private readonly records: EntryRecord[] = [];
  private readonly forceZip64: boolean;
  private readonly deflateOptions: ZlibOptions;
  /** Bytes handed to the output so far, which is also where the next record starts. */
  private offset = 0;
  private queue: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | null = null;
  private outputError: Error | null = null;
  private done = false;

  constructor(
    private readonly output: Writable,
    options: ZipWriterOptions = {},
  ) {
    this.forceZip64 = options.forceZip64 ?? false;
    this.deflateOptions = options.level === undefined ? {} : { level: options.level };
    // Held, not thrown: an `error` event with no listener would take the
    // process down, and the next call reports it anyway.
    output.on('error', (error: Error) => {
      this.outputError ??= error;
    });
  }

  /** Bytes written to the output so far. */
  get bytesWritten(): number {
    return this.offset;
  }

  get entryCount(): number {
    return this.records.length;
  }

  /** Adds a folder entry, `name/`. Parents are not added implicitly; readers do not need them. */
  addDirectory(name: string, mtime: Date, mode = 0o755): Promise<void> {
    return this.enqueue(() =>
      this.writeStoredEntry(this.encodeName(name, true), EMPTY, mtime, unixAttributes(S_IFDIR, mode) | DOS_DIRECTORY),
    );
  }

  /**
   * Adds a symlink as Unix tools do: the target as the entry's content, the
   * link type in the mode. Readers that do not know the convention extract a
   * small text file instead.
   */
  addSymlink(name: string, target: string, mtime: Date): Promise<void> {
    return this.enqueue(() =>
      this.writeStoredEntry(
        this.encodeName(name, false),
        Buffer.from(target, 'utf8'),
        mtime,
        unixAttributes(S_IFLNK, 0o777),
      ),
    );
  }

  /**
   * Adds a file, streaming `source` into the archive. A source that turns out
   * to be empty is stored with no data at all, as the spec suggests; anything
   * else is deflated (or stored, if asked) with a data descriptor.
   */
  addFile(name: string, source: Readable, options: ZipFileOptions): Promise<void> {
    return this.enqueue(() => this.writeFile(name, source, options));
  }

  /**
   * Writes the central directory and the end records — the ZIP64 ones too
   * when more than 65 534 entries or an offset past 4 GiB needs them — then
   * ends the output and waits for it to flush.
   */
  finish(): Promise<void> {
    return this.enqueue(async () => {
      await this.writeCentralDirectory();
      this.done = true;
      this.output.end();
      await finished(this.output);
    });
  }

  /**
   * Runs `operation` after everything queued before it. A failure that wrote
   * nothing (a bad name, an abort before the first byte) leaves the archive
   * intact and the writer usable; one that wrote something does not.
   */
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      this.assertUsable();
      const start = this.offset;
      try {
        await operation();
      } catch (error) {
        if (this.offset !== start) {
          this.failure ??= { error };
        }
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private assertUsable(): void {
    if (this.done) {
      throw new ZipError('WRITER_FAILED', 'The ZIP archive is already finished');
    }
    if (this.failure !== null) {
      throw new ZipError('WRITER_FAILED', 'An earlier entry failed part-way; the ZIP archive is incomplete', {
        cause: this.failure.error,
      });
    }
    if (this.outputError !== null) {
      throw new ZipError('WRITER_FAILED', 'The ZIP output failed', { cause: this.outputError });
    }
  }

  private encodeName(name: string, directory: boolean): Buffer {
    const normalized = normalizeEntryName(name);
    if (normalized === null) {
      throw new ZipError('INVALID_NAME', `Not a relative path inside the archive: ${JSON.stringify(name)}`);
    }
    const bytes = Buffer.from(directory ? `${normalized}/` : normalized, 'utf8');
    if (bytes.length > MAX_UINT16) {
      throw new ZipError('INVALID_NAME', `Entry name longer than ${MAX_UINT16} bytes: ${normalized.slice(0, 80)}…`);
    }
    return bytes;
  }

  /** An entry whose bytes are all known up front: sizes and CRC go in the local header, no descriptor. */
  private async writeStoredEntry(name: Buffer, data: Buffer, mtime: Date, externalAttributes: number): Promise<void> {
    const record = this.newRecord(name, FLAG_UTF8, METHOD_STORE, mtime, externalAttributes, false);
    record.crc = Crc32.compute(data);
    record.size = data.length;
    record.compressedSize = data.length;
    await this.write(this.localHeader(record, false));
    if (data.length > 0) {
      await this.write(data);
    }
    this.records.push(record);
  }

  private async writeFile(name: string, source: Readable, options: ZipFileOptions): Promise<void> {
    const { signal, onBytes } = options;
    const encodedName = this.encodeName(name, false);
    const attributes = unixAttributes(S_IFREG, options.mode ?? 0o644);
    const iterator = source[Symbol.asyncIterator]() as AsyncIterator<unknown>;

    try {
      // Look before writing anything: an empty source is a stored entry with
      // no data, and an abort now costs the archive nothing.
      let first: Buffer | null = null;
      while (first === null) {
        signal?.throwIfAborted();
        const next = await abortable(iterator.next(), signal);
        if (next.done) {
          break;
        }
        const chunk = toBuffer(next.value);
        if (chunk.length > 0) {
          first = chunk;
        }
      }
      if (first === null) {
        await this.writeStoredEntry(encodedName, EMPTY, options.mtime, attributes);
        return;
      }

      const method = options.method === 'store' ? METHOD_STORE : METHOD_DEFLATE;
      const hint = options.size;
      const zip64Local = this.forceZip64 || hint === undefined || hint > SMALL_ENTRY_LIMIT;
      const record = this.newRecord(
        encodedName,
        FLAG_UTF8 | FLAG_DATA_DESCRIPTOR,
        method,
        options.mtime,
        attributes,
        zip64Local,
      );
      await this.write(this.localHeader(record, true));

      const crc = new Crc32();
      const firstChunk = first;
      async function* chunks(): AsyncGenerator<Buffer> {
        yield firstChunk;
        for (;;) {
          const next = await iterator.next();
          if (next.done) {
            return;
          }
          yield toBuffer(next.value);
        }
      }
      async function* measure(input: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
        for await (const chunk of input) {
          if (chunk.length === 0) {
            continue;
          }
          crc.update(chunk);
          record.size += chunk.length;
          onBytes?.(chunk.length);
          yield chunk;
        }
      }
      const sink = async (input: AsyncIterable<Buffer>): Promise<void> => {
        for await (const chunk of input) {
          record.compressedSize += chunk.length;
          await this.write(chunk);
        }
      };
      const pipelineOptions = signal === undefined ? {} : { signal };
      if (method === METHOD_DEFLATE) {
        await pipeline(Readable.from(chunks()), measure, createDeflateRaw(this.deflateOptions), sink, pipelineOptions);
      } else {
        await pipeline(Readable.from(chunks()), measure, sink, pipelineOptions);
      }
      record.crc = crc.digest();

      if (!zip64Local && (record.size >= MAX_UINT32 || record.compressedSize >= MAX_UINT32)) {
        throw new ZipError(
          'TOO_LARGE',
          `${JSON.stringify(name)} outgrew its size hint of ${hint} bytes past what a non-ZIP64 entry can hold`,
        );
      }
      await this.write(dataDescriptor(record));
      this.records.push(record);
    } catch (error) {
      source.destroy();
      throw error;
    }
  }

  private newRecord(
    name: Buffer,
    flags: number,
    method: number,
    mtime: Date,
    externalAttributes: number,
    zip64Local: boolean,
  ): EntryRecord {
    const dos = toDosDateTime(mtime);
    const seconds = Math.floor(mtime.getTime() / 1000);
    return {
      name,
      flags,
      method,
      dosDate: dos.date,
      dosTime: dos.time,
      // Signed 32-bit, as most readers take it: past 2038 the DOS time alone is safer than a negative one.
      unixTime: Number.isFinite(seconds) && seconds >= 0 && seconds <= 0x7fffffff ? seconds : null,
      externalAttributes,
      offset: this.offset,
      zip64Local,
      crc: 0,
      compressedSize: 0,
      size: 0,
    };
  }

  /**
   * With a data descriptor to follow, the CRC and sizes here are zero — or
   * 0xFFFFFFFF with a ZIP64 extra field of zeros, which the spec requires
   * to hold *both* sizes whenever it is in a local header.
   */
  private localHeader(record: EntryRecord, descriptor: boolean): Buffer {
    const extras: Buffer[] = [];
    if (record.zip64Local) {
      extras.push(zip64Extra([0, 0]));
    }
    if (record.unixTime !== null) {
      extras.push(extendedTimestamp(record.unixTime));
    }
    const extra = Buffer.concat(extras);

    const header = Buffer.alloc(LOCAL_HEADER_SIZE);
    header.writeUInt32LE(SIG_LOCAL_HEADER, 0);
    header.writeUInt16LE(record.zip64Local ? VERSION_ZIP64 : VERSION_DEFAULT, 4);
    header.writeUInt16LE(record.flags, 6);
    header.writeUInt16LE(record.method, 8);
    header.writeUInt16LE(record.dosTime, 10);
    header.writeUInt16LE(record.dosDate, 12);
    if (descriptor) {
      header.writeUInt32LE(0, 14);
      header.writeUInt32LE(record.zip64Local ? MAX_UINT32 : 0, 18);
      header.writeUInt32LE(record.zip64Local ? MAX_UINT32 : 0, 22);
    } else {
      header.writeUInt32LE(record.crc, 14);
      header.writeUInt32LE(record.compressedSize, 18);
      header.writeUInt32LE(record.size, 22);
    }
    header.writeUInt16LE(record.name.length, 26);
    header.writeUInt16LE(extra.length, 28);
    return Buffer.concat([header, record.name, extra]);
  }

  /**
   * One central directory header. A size or offset goes to the ZIP64 extra
   * field only when it does not fit (or `forceZip64` says so), in the fixed
   * order size, compressed size, offset — a reader matches the fields to the
   * 0xFFFFFFFF markers by that order.
   */
  private centralHeader(record: EntryRecord): Buffer {
    const zip64Values: number[] = [];
    const field = (value: number): number => {
      if (this.forceZip64 || value >= MAX_UINT32) {
        zip64Values.push(value);
        return MAX_UINT32;
      }
      return value;
    };
    const size = field(record.size);
    const compressedSize = field(record.compressedSize);
    const offset = field(record.offset);

    const extras: Buffer[] = [];
    if (zip64Values.length > 0) {
      extras.push(zip64Extra(zip64Values));
    }
    if (record.unixTime !== null) {
      extras.push(extendedTimestamp(record.unixTime));
    }
    const extra = Buffer.concat(extras);
    const zip64 = record.zip64Local || zip64Values.length > 0;

    const header = Buffer.alloc(CENTRAL_HEADER_SIZE);
    header.writeUInt32LE(SIG_CENTRAL_HEADER, 0);
    header.writeUInt16LE(VERSION_MADE_BY, 4);
    header.writeUInt16LE(zip64 ? VERSION_ZIP64 : VERSION_DEFAULT, 6);
    header.writeUInt16LE(record.flags, 8);
    header.writeUInt16LE(record.method, 10);
    header.writeUInt16LE(record.dosTime, 12);
    header.writeUInt16LE(record.dosDate, 14);
    header.writeUInt32LE(record.crc, 16);
    header.writeUInt32LE(compressedSize, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(record.name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    // Comment length, disk number start, internal attributes: all zero.
    header.writeUInt32LE(record.externalAttributes, 38);
    header.writeUInt32LE(offset, 42);
    return Buffer.concat([header, record.name, extra]);
  }

  private async writeCentralDirectory(): Promise<void> {
    const start = this.offset;
    let batch: Buffer[] = [];
    let batchLength = 0;
    for (const record of this.records) {
      const header = this.centralHeader(record);
      batch.push(header);
      batchLength += header.length;
      if (batchLength >= CENTRAL_DIRECTORY_BATCH) {
        await this.write(Buffer.concat(batch));
        batch = [];
        batchLength = 0;
      }
    }
    if (batch.length > 0) {
      await this.write(Buffer.concat(batch));
    }
    const size = this.offset - start;
    const count = this.records.length;

    const zip64 = this.forceZip64 || count >= MAX_UINT16 || start >= MAX_UINT32 || size >= MAX_UINT32;
    if (zip64) {
      const recordOffset = this.offset;
      const record = Buffer.alloc(ZIP64_EOCD_SIZE);
      record.writeUInt32LE(SIG_ZIP64_EOCD, 0);
      // The record's size counts what follows this field, not the 12 bytes before it.
      record.writeBigUInt64LE(BigInt(ZIP64_EOCD_SIZE - 12), 4);
      record.writeUInt16LE(VERSION_MADE_BY, 12);
      record.writeUInt16LE(VERSION_ZIP64, 14);
      // This disk and the central directory's disk: both 0, there is one.
      record.writeBigUInt64LE(BigInt(count), 24);
      record.writeBigUInt64LE(BigInt(count), 32);
      record.writeBigUInt64LE(BigInt(size), 40);
      record.writeBigUInt64LE(BigInt(start), 48);

      const locator = Buffer.alloc(ZIP64_LOCATOR_SIZE);
      locator.writeUInt32LE(SIG_ZIP64_LOCATOR, 0);
      locator.writeBigUInt64LE(BigInt(recordOffset), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([record, locator]));
    }

    // Forced, every field is the marker, so a reader has to take the ZIP64 path to get anything right.
    const clamp16 = (value: number): number => (this.forceZip64 ? MAX_UINT16 : Math.min(value, MAX_UINT16));
    const clamp32 = (value: number): number => (this.forceZip64 ? MAX_UINT32 : Math.min(value, MAX_UINT32));
    const end = Buffer.alloc(EOCD_SIZE);
    end.writeUInt32LE(SIG_EOCD, 0);
    end.writeUInt16LE(clamp16(count), 8);
    end.writeUInt16LE(clamp16(count), 10);
    end.writeUInt32LE(clamp32(size), 12);
    end.writeUInt32LE(clamp32(start), 16);
    await this.write(end);
  }

  /** Writes one chunk, waiting for `drain` when the output says it has enough. */
  private async write(chunk: Buffer): Promise<void> {
    if (this.outputError !== null) {
      throw this.outputError;
    }
    if (this.output.destroyed || this.output.writableEnded) {
      throw new ZipError('WRITER_FAILED', 'The ZIP output was closed before the archive was finished');
    }
    this.offset += chunk.length;
    if (!this.output.write(chunk)) {
      await drained(this.output);
    }
  }
}

/** Resolves on `drain`; rejects if the output errors or closes first, which would otherwise leave the wait hanging. */
function drained(output: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      output.off('drain', onDrain);
      output.off('error', onError);
      output.off('close', onClose);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new ZipError('WRITER_FAILED', 'The ZIP output was closed before the archive was finished'));
    };
    output.on('drain', onDrain);
    output.on('error', onError);
    output.on('close', onClose);
  });
}

/** `promise`, or a rejection with the signal's reason as soon as it aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8');
  }
  throw new TypeError('A ZIP entry source must yield Buffers, Uint8Arrays or strings');
}

/** The Unix type and mode in the high 16 bits of the external attributes, where Info-ZIP puts them. */
function unixAttributes(type: number, mode: number): number {
  return ((type | (mode & 0o7777)) << 16) >>> 0;
}

function zip64Extra(values: readonly number[]): Buffer {
  const field = Buffer.alloc(4 + values.length * 8);
  field.writeUInt16LE(EXTRA_ZIP64, 0);
  field.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => field.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  return field;
}

/** Info-ZIP "UT" with the modification time only — the same 9 bytes in the local and the central header. */
function extendedTimestamp(seconds: number): Buffer {
  const field = Buffer.alloc(9);
  field.writeUInt16LE(EXTRA_EXTENDED_TIMESTAMP, 0);
  field.writeUInt16LE(5, 2);
  field.writeUInt8(1, 4);
  field.writeUInt32LE(seconds, 5);
  return field;
}

/** Signature, CRC and both sizes — 8 bytes each when the local header announced ZIP64. */
function dataDescriptor(record: EntryRecord): Buffer {
  if (record.zip64Local) {
    const descriptor = Buffer.alloc(24);
    descriptor.writeUInt32LE(SIG_DATA_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(record.crc, 4);
    descriptor.writeBigUInt64LE(BigInt(record.compressedSize), 8);
    descriptor.writeBigUInt64LE(BigInt(record.size), 16);
    return descriptor;
  }
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(SIG_DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(record.crc, 4);
  descriptor.writeUInt32LE(record.compressedSize, 8);
  descriptor.writeUInt32LE(record.size, 12);
  return descriptor;
}
