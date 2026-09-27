import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { pipeline, Readable, Transform, type TransformCallback } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

import { Crc32 } from './crc32.js';
import { fromDosDateTime } from './dos-time.js';
import type { ZipEntry, ZipListItem } from './zip-entry.js';
import { ZipError } from './zip-error.js';
import { decodeCp437, decodeUtf8, normalizeEntryName } from './zip-name.js';
import {
  CENTRAL_HEADER_SIZE,
  DOS_DIRECTORY,
  EOCD_SIZE,
  EXTRA_EXTENDED_TIMESTAMP,
  EXTRA_UNICODE_PATH,
  EXTRA_ZIP64,
  FLAG_ENCRYPTED,
  FLAG_STRONG_ENCRYPTION,
  FLAG_UTF8,
  HOST_OSX,
  HOST_UNIX,
  LOCAL_HEADER_SIZE,
  MAX_COMMENT_LENGTH,
  MAX_UINT16,
  MAX_UINT32,
  METHOD_DEFLATE,
  METHOD_STORE,
  SIG_CENTRAL_HEADER,
  SIG_EOCD,
  SIG_LOCAL_HEADER,
  SIG_ZIP64_EOCD,
  SIG_ZIP64_LOCATOR,
  S_IFDIR,
  S_IFLNK,
  S_IFMT,
  ZIP64_EOCD_SIZE,
  ZIP64_LOCATOR_SIZE,
} from './zip.constants.js';

export interface ZipReaderOptions {
  /**
   * The central directory is read into memory whole; past this it is not
   * read at all. 256 MiB is some two million entries with long names — far
   * beyond any real archive, well short of what a crafted one could ask for.
   */
  readonly maxCentralDirectoryBytes?: number;
  /** Entries at most. */
  readonly maxEntries?: number;
}

const DEFAULT_MAX_CENTRAL_DIRECTORY = 256 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 2_000_000;

/** Chunk size for reading entry data; larger than the 64 KiB default to cut syscalls on big files. */
const READ_CHUNK = 256 * 1024;

/** Where the central directory is and how many entries it claims, from the end records. */
interface Directory {
  readonly offset: number;
  readonly size: number;
  readonly count: number;
  /** Bytes of something (a self-extractor stub, say) prepended to the archive, which every stored offset ignores. */
  readonly base: number;
}

/**
 * Reads a ZIP archive in place: the end records and the central directory
 * with positional reads, an entry's data with a ranged `createReadStream`
 * when asked. Nothing larger than the central directory is ever in memory.
 *
 * Every entry name is normalized on the way in (`safeName`). An entry whose
 * name cannot be made a safe relative path is kept — flagged `unsafe`, so a
 * caller can say what was skipped — but `list` leaves it out.
 */
export class ZipReader {
  private tree: Map<string, Map<string, ZipListItem>> | null = null;
  private closed = false;

  private constructor(
    readonly path: string,
    private readonly handle: FileHandle,
    private readonly archiveSize: number,
    readonly entries: readonly ZipEntry[],
  ) {}

  /**
   * Opens `path` and reads its central directory. Throws `ZipError`
   * (`NOT_A_ZIP`, `CORRUPT`, `UNSUPPORTED`, `TOO_LARGE`) for an archive it
   * cannot use, file-system errors as they are.
   */
  static async open(path: string, options: ZipReaderOptions = {}): Promise<ZipReader> {
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      const directory = await locateCentralDirectory(handle, size);
      const maxBytes = options.maxCentralDirectoryBytes ?? DEFAULT_MAX_CENTRAL_DIRECTORY;
      const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
      if (directory.size > maxBytes) {
        throw new ZipError('TOO_LARGE', `The ZIP central directory is ${directory.size} bytes; at most ${maxBytes} are read`);
      }
      if (directory.count > maxEntries) {
        throw new ZipError('TOO_LARGE', `The ZIP archive has ${directory.count} entries; at most ${maxEntries} are read`);
      }
      if (directory.count * CENTRAL_HEADER_SIZE > directory.size) {
        throw new ZipError('CORRUPT', 'The ZIP central directory is too small for the entries it claims');
      }
      const buffer = await readExactly(handle, directory.base + directory.offset, directory.size);
      const entries = parseCentralDirectory(buffer, directory, maxEntries);
      return new ZipReader(path, handle, size, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /**
   * `name` as a safe relative path inside the archive, or `null` — see
   * `normalizeEntryName`. The same rule `entries` applies, for callers that
   * build paths of their own (a folder to `list`, a name to write).
   */
  static safeName(name: string): string | null {
    return normalizeEntryName(name);
  }

  /**
   * The entry's uncompressed bytes. The CRC-32 and size are checked as the
   * last byte passes: a mismatch errors the stream (`CRC_MISMATCH`,
   * `SIZE_MISMATCH`), so a consumer that writes the data somewhere must treat
   * that error as "discard what you wrote". Inflating past the declared size
   * errors at once, which also bounds what a deflate bomb can produce.
   */
  async openReadStream(entry: ZipEntry): Promise<Readable> {
    this.assertOpen();
    if (entry.encrypted) {
      throw new ZipError('ENCRYPTED', `${entry.name} is encrypted`);
    }
    if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
      throw new ZipError('UNSUPPORTED', `${entry.name} uses compression method ${entry.method}; only store and deflate are supported`);
    }
    if (entry.method === METHOD_STORE && entry.compressedSize !== entry.size) {
      throw new ZipError('CORRUPT', `${entry.name} is stored, yet its compressed and uncompressed sizes differ`);
    }

    // The data starts after the *local* header's name and extra field, whose
    // lengths need not match the central directory's.
    const header = await readExactly(this.handle, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
    if (header.readUInt32LE(0) !== SIG_LOCAL_HEADER) {
      throw new ZipError('CORRUPT', `No local header where the central directory puts ${entry.name}`);
    }
    const dataStart = entry.localHeaderOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (dataStart + entry.compressedSize > this.archiveSize) {
      throw new ZipError('CORRUPT', `The data of ${entry.name} runs past the end of the archive`);
    }

    const verifier = new EntryVerifier(entry);
    // `createReadStream` rejects an empty range (end < start), so an empty entry reads from nothing.
    const raw =
      entry.compressedSize === 0
        ? Readable.from([])
        : createReadStream(this.path, {
            start: dataStart,
            end: dataStart + entry.compressedSize - 1,
            highWaterMark: READ_CHUNK,
          });
    // The callback form hands back the last stream at once; an error anywhere
    // upstream is put on it, where the consumer is listening.
    const onDone = (error: Error | null): void => {
      if (error) {
        verifier.destroy(error);
      }
    };
    if (entry.method === METHOD_DEFLATE) {
      pipeline(raw, createInflateRaw(), verifier, onDone);
    } else {
      pipeline(raw, verifier, onDone);
    }
    return verifier;
  }

  /**
   * The direct children of `folder` ('' is the top), in archive order.
   * Folders that only exist because deeper entries name them — many archives
   * have no folder entries at all — are listed too, with no `mtime` and no
   * `entry`. `null` when there is no such folder in the archive.
   *
   * When a file and a folder claim the same path the folder wins, as that is
   * the only way its children stay reachable; of two files, the later wins.
   */
  list(folder: string): readonly ZipListItem[] | null {
    const trimmed = folder.replace(/^\/+|\/+$/g, '');
    const key = trimmed === '' ? '' : normalizeEntryName(trimmed);
    if (key === null) {
      return null;
    }
    const children = this.listingTree().get(key);
    return children ? [...children.values()] : null;
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.handle.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ZipError('UNSUPPORTED', 'The ZIP reader is closed');
    }
  }

  /** Folder path → its children by name, built on the first `list` and kept. */
  private listingTree(): Map<string, Map<string, ZipListItem>> {
    if (this.tree !== null) {
      return this.tree;
    }
    const tree = new Map<string, Map<string, ZipListItem>>([['', new Map()]]);
    const ensureFolder = (path: string, entry: ZipEntry | null): void => {
      const slash = path.lastIndexOf('/');
      const parent = slash === -1 ? '' : path.slice(0, slash);
      const name = path.slice(slash + 1);
      if (!tree.has(path)) {
        tree.set(path, new Map());
      }
      if (parent !== '') {
        ensureFolder(parent, null);
      }
      const siblings = tree.get(parent)!;
      const existing = siblings.get(name);
      if (existing?.isDirectory && (entry === null || existing.entry !== null)) {
        return;
      }
      siblings.set(name, {
        name,
        path,
        isDirectory: true,
        isSymlink: false,
        size: 0,
        mtime: entry?.mtime ?? null,
        entry,
      });
    };

    for (const entry of this.entries) {
      if (entry.unsafe) {
        continue;
      }
      if (entry.isDirectory) {
        ensureFolder(entry.name, entry);
        continue;
      }
      const slash = entry.name.lastIndexOf('/');
      const parent = slash === -1 ? '' : entry.name.slice(0, slash);
      const name = entry.name.slice(slash + 1);
      if (parent !== '') {
        ensureFolder(parent, null);
      }
      const siblings = tree.get(parent)!;
      if (siblings.get(name)?.isDirectory) {
        continue;
      }
      siblings.set(name, {
        name,
        path: entry.name,
        isDirectory: false,
        isSymlink: entry.isSymlink,
        size: entry.size,
        mtime: entry.mtime,
        entry,
      });
    }
    this.tree = tree;
    return tree;
  }
}

/** Counts and checksums an entry's bytes on their way out, failing the stream on the first disagreement. */
class EntryVerifier extends Transform {
  private readonly crc = new Crc32();
  private size = 0;

  constructor(private readonly entry: ZipEntry) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.entry.size) {
      callback(this.sizeMismatch());
      return;
    }
    this.crc.update(chunk);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    if (this.size !== this.entry.size) {
      callback(this.sizeMismatch());
    } else if (this.crc.digest() !== this.entry.crc32) {
      callback(new ZipError('CRC_MISMATCH', `${this.entry.name} is damaged: its CRC-32 does not match`));
    } else {
      callback();
    }
  }

  private sizeMismatch(): ZipError {
    return new ZipError('SIZE_MISMATCH', `${this.entry.name} is damaged: it is not the ${this.entry.size} bytes its header says`);
  }
}

/** Reads exactly `length` bytes at `position`; a short read means the archive is shorter than its records say. */
async function readExactly(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) {
      throw new ZipError('CORRUPT', 'The ZIP archive ends before its records do');
    }
    filled += bytesRead;
  }
  return buffer;
}

/** A 64-bit little-endian field as a number, refused past 2^53 (no real archive, and arithmetic would go wrong). */
function readUInt64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError('CORRUPT', 'A ZIP64 size or offset is out of range');
  }
  return Number(value);
}

/**
 * Finds the end of central directory record — the last one, searching back
 * over at most a maximal comment — and, when a ZIP64 locator sits right
 * before it, the ZIP64 record that supersedes its fields.
 */
async function locateCentralDirectory(handle: FileHandle, fileSize: number): Promise<Directory> {
  if (fileSize < EOCD_SIZE) {
    throw new ZipError('NOT_A_ZIP', 'Too short to be a ZIP archive');
  }
  const tailLength = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT_LENGTH);
  const tailStart = fileSize - tailLength;
  const tail = await readExactly(handle, tailStart, tailLength);

  let at = -1;
  for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD && i + EOCD_SIZE + tail.readUInt16LE(i + 20) <= tailLength) {
      at = i;
      break;
    }
  }
  if (at === -1) {
    throw new ZipError('NOT_A_ZIP', 'No ZIP end of central directory record found');
  }
  const eocdPosition = tailStart + at;
  const disk = tail.readUInt16LE(at + 4);
  const directoryDisk = tail.readUInt16LE(at + 6);
  let count = tail.readUInt16LE(at + 10);
  let size = tail.readUInt32LE(at + 12);
  let offset = tail.readUInt32LE(at + 16);
  let end = eocdPosition;

  const zip64 = eocdPosition >= ZIP64_LOCATOR_SIZE ? await findZip64Record(handle, eocdPosition) : null;
  if (zip64 !== null) {
    if (zip64.record.readUInt32LE(16) !== 0 || zip64.record.readUInt32LE(20) !== 0) {
      throw new ZipError('UNSUPPORTED', 'Split (multi-disk) ZIP archives are not supported');
    }
    count = readUInt64(zip64.record, 32);
    size = readUInt64(zip64.record, 40);
    offset = readUInt64(zip64.record, 48);
    end = zip64.position;
  } else if ((disk !== 0 && disk !== MAX_UINT16) || (directoryDisk !== 0 && directoryDisk !== MAX_UINT16)) {
    throw new ZipError('UNSUPPORTED', 'Split (multi-disk) ZIP archives are not supported');
  }

  // The central directory ends where the end records begin; if its stored
  // offset says otherwise, something was prepended, and every offset is short by that.
  const base = end - size - offset;
  if (base < 0) {
    throw new ZipError('CORRUPT', 'The ZIP central directory does not fit before the end record');
  }
  return { offset, size, count, base };
}

/**
 * The ZIP64 end of central directory record, if the locator says there is
 * one. The locator's offset is tried first, then the spot right before it —
 * where it always is unless the archive has data prepended.
 */
async function findZip64Record(
  handle: FileHandle,
  eocdPosition: number,
): Promise<{ readonly record: Buffer; readonly position: number } | null> {
  const locatorPosition = eocdPosition - ZIP64_LOCATOR_SIZE;
  const locator = await readExactly(handle, locatorPosition, ZIP64_LOCATOR_SIZE);
  if (locator.readUInt32LE(0) !== SIG_ZIP64_LOCATOR) {
    return null;
  }
  if (locator.readUInt32LE(16) > 1) {
    throw new ZipError('UNSUPPORTED', 'Split (multi-disk) ZIP archives are not supported');
  }
  const candidates = [readUInt64(locator, 8), locatorPosition - ZIP64_EOCD_SIZE];
  for (const position of candidates) {
    if (position < 0 || position + ZIP64_EOCD_SIZE > locatorPosition) {
      continue;
    }
    const record = await readExactly(handle, position, ZIP64_EOCD_SIZE);
    if (record.readUInt32LE(0) === SIG_ZIP64_EOCD) {
      return { record, position };
    }
  }
  throw new ZipError('CORRUPT', 'A ZIP64 locator points to no ZIP64 end of central directory record');
}

/** Everything the extra fields of one central header contribute. */
interface Extras {
  size: number;
  compressedSize: number;
  offset: number;
  unixTime: number | null;
  unicodeName: string | null;
}

function parseCentralDirectory(buffer: Buffer, directory: Directory, maxEntries: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let at = 0;
  // The count is a sanity bound only: tools that overflow the 16-bit field
  // without writing ZIP64 exist, so the directory's own length decides.
  while (at < buffer.length) {
    if (entries.length >= maxEntries) {
      throw new ZipError('TOO_LARGE', `The ZIP archive has more than ${maxEntries} entries`);
    }
    if (at + CENTRAL_HEADER_SIZE > buffer.length || buffer.readUInt32LE(at) !== SIG_CENTRAL_HEADER) {
      throw new ZipError('CORRUPT', 'A ZIP central directory header is malformed');
    }
    const madeBy = buffer.readUInt16LE(at + 4);
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const dosTime = buffer.readUInt16LE(at + 12);
    const dosDate = buffer.readUInt16LE(at + 14);
    const crc32 = buffer.readUInt32LE(at + 16);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const externalAttributes = buffer.readUInt32LE(at + 38);
    const nameStart = at + CENTRAL_HEADER_SIZE;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > buffer.length) {
      throw new ZipError('CORRUPT', 'A ZIP central directory header runs past the directory');
    }
    const nameBytes = buffer.subarray(nameStart, extraStart);
    const extras = parseExtras(buffer.subarray(extraStart, extraStart + extraLength), nameBytes, {
      size: buffer.readUInt32LE(at + 24),
      compressedSize: buffer.readUInt32LE(at + 20),
      offset: buffer.readUInt32LE(at + 42),
      unixTime: null,
      unicodeName: null,
    });

    const rawName = flags & FLAG_UTF8 ? decodeUtf8(nameBytes) : (extras.unicodeName ?? decodeCp437(nameBytes));
    const host = madeBy >> 8;
    const unixMode = host === HOST_UNIX || host === HOST_OSX ? externalAttributes >>> 16 : 0;
    const mode = unixMode === 0 ? null : unixMode;
    const type = mode === null ? 0 : mode & S_IFMT;
    const isDirectory =
      rawName.endsWith('/') || rawName.endsWith('\\') || type === S_IFDIR || (externalAttributes & DOS_DIRECTORY) !== 0;
    const safe = normalizeEntryName(rawName);
    const localHeaderOffset = directory.base + extras.offset;

    entries.push({
      name: safe ?? rawName,
      rawName,
      unsafe: safe === null,
      isDirectory,
      isSymlink: !isDirectory && type === S_IFLNK,
      size: extras.size,
      compressedSize: extras.compressedSize,
      mtime: extras.unixTime === null ? fromDosDateTime(dosDate, dosTime) : new Date(extras.unixTime * 1000),
      mode,
      method,
      crc32,
      encrypted: (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0,
      localHeaderOffset,
    });
    at = next;
  }
  if (entries.length < directory.count) {
    throw new ZipError('CORRUPT', `The ZIP central directory holds ${entries.length} of the ${directory.count} entries it claims`);
  }
  return entries;
}

/**
 * Walks an extra-field block. The ZIP64 field holds only the values whose
 * 32-bit field is the 0xFFFFFFFF marker, in the order size, compressed size,
 * offset — so which bytes mean what depends on the header, not on the field.
 */
function parseExtras(extra: Buffer, nameBytes: Buffer, values: Extras): Extras {
  let at = 0;
  while (at + 4 <= extra.length) {
    const tag = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    const start = at + 4;
    const end = start + length;
    if (end > extra.length) {
      break;
    }
    const data = extra.subarray(start, end);
    if (tag === EXTRA_ZIP64) {
      let cursor = 0;
      const take = (): number => {
        if (cursor + 8 > data.length) {
          throw new ZipError('CORRUPT', 'A ZIP64 extra field is shorter than its header needs');
        }
        const value = readUInt64(data, cursor);
        cursor += 8;
        return value;
      };
      if (values.size === MAX_UINT32) values.size = take();
      if (values.compressedSize === MAX_UINT32) values.compressedSize = take();
      if (values.offset === MAX_UINT32) values.offset = take();
    } else if (tag === EXTRA_EXTENDED_TIMESTAMP && data.length >= 5 && (data[0]! & 1) !== 0) {
      values.unixTime = data.readInt32LE(1);
    } else if (tag === EXTRA_UNICODE_PATH && data.length >= 5 && data[0] === 1) {
      // Only trusted while it still describes the header name it was written for.
      if (data.readUInt32LE(1) === Crc32.compute(nameBytes)) {
        values.unicodeName = decodeUtf8(data.subarray(5));
      }
    }
    at = end;
  }
  return values;
}
