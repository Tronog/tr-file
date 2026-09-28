import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError, type Logger } from '../../core/index.js';
import type { ArchiveService } from '../archive/index.js';
import type { AuthService } from '../auth/index.js';
import { WATCH_MAX_PATHS, type FileDetails, type FilesService, type PlacesService, type WatchService } from '../files/index.js';
import { isGitAction, parseGitRequest, type GitService } from '../git/index.js';
import { serverTime } from '../health/server-time.js';
import { parseDecision, parseOperationRequest, type OperationsService } from '../operations/index.js';
import {
  FS_BRIDGE_CHUNK_BYTES,
  type FsBridgeFailure,
  type FsBridgeRequest,
  type FsBridgeResponse,
  type FsBridgeSession,
  type FsLocalPath,
  type FsReadRequest,
  type FsReadResult,
  type FsUploadBeginRequest,
  type FsUploadBeginResult,
  type FsUploadChunkRequest,
} from './bridge.model.js';

/** An upload that has not been touched for this long is given up on. */
const UPLOAD_IDLE_MS = 60_000;

/** One upload whose bytes are still arriving, chunk by chunk. */
interface UploadSession {
  /** What the chunks are written into; `storeUpload` drains it to disk. */
  readonly stream: PassThrough;
  /** Settles when the file is stored, or when storing it failed. */
  readonly done: Promise<FileDetails>;
  /** Why `done` rejected, as soon as it has — so a chunk can fail fast. */
  failure?: unknown;
  received: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Progress of a `saveCopy`, for the caller to relay however it likes. */
export interface FsSaveCopyOptions {
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * The file-system API without HTTP (PRD 001, §8.1).
 *
 * `FilesRoutes` turns HTTP requests into `FilesService` calls; this turns
 * plain command objects into the same calls. Both are thin, and both sit on
 * the *same* `FilesService` instance — same path resolver, same root
 * confinement, same upload ceiling — which is the point: the desktop does not
 * get a second, laxer way into the file system, it gets a second way to ask.
 *
 * Two rules follow from the channel this is reached through:
 *
 * 1. **Requests are untrusted.** They arrive from a renderer over IPC, so
 *    every field is validated here rather than assumed from the type.
 * 2. **Failures are returned, not thrown.** An `Error` crossing a structured
 *    clone boundary loses its type, its code and usually its message, so a
 *    failure is flattened into the same `{ error: { code, message } }` shape
 *    HTTP would have sent — plus the status that shape would have had.
 * 3. **It asks for the same account HTTP does** (PRD 003, §2). When signing
 *    in is on, a connection's `FsBridgeSession` must have signed in before
 *    any file-system command is answered; the check is here, not in the
 *    channel, so no caller of the bridge can forget it.
 * 4. **No file crosses whole** (PRD 003, §1). Reads and uploads move in
 *    chunks of at most `FS_BRIDGE_CHUNK_BYTES`, so neither process ever holds
 *    more than one of them for a transfer — the HTTP side streams, and this
 *    one must not be the place a large file costs its size twice.
 */
export class FileSystemBridge {
  /** Uploads in progress, by the id `upload-begin` handed out. */
  private readonly uploads = new Map<string, UploadSession>();

  constructor(
    private readonly files: FilesService,
    private readonly logger: Logger,
    private readonly auth: AuthService,
    private readonly operations: OperationsService,
    private readonly watches: WatchService,
    private readonly placesService: PlacesService,
    private readonly archives: ArchiveService,
    private readonly git: GitService,
  ) {}

  /** A connection that has not signed in; the channel keeps one per window. */
  static openSession(): FsBridgeSession {
    return { username: null };
  }

  /**
   * Runs one command for `session`. Never throws; a failure is part of the
   * answer. Without a session the command is treated as coming from a
   * connection that never signed in.
   */
  async dispatch(request: unknown, session: FsBridgeSession = FileSystemBridge.openSession()): Promise<FsBridgeResponse> {
    const startedAt = performance.now();
    try {
      const parsed = FileSystemBridge.parse(request);
      const data = await this.run(parsed, session);
      // The HTTP side logs every request through `RequestLoggerMiddleware`;
      // the bridge would otherwise be a silent second door into the same API.
      this.logger.debug('command', {
        command: parsed.command,
        ...('path' in parsed
          ? { path: parsed.path }
          : 'uploadId' in parsed
            ? { uploadId: parsed.uploadId }
            : 'jobId' in parsed
              ? { jobId: parsed.jobId }
              : 'watchId' in parsed
                ? { watchId: parsed.watchId, paths: parsed.paths.length }
                : 'paths' in parsed
                  ? { paths: parsed.paths.length }
                  : 'ids' in parsed
                    ? { ids: parsed.ids.length }
                    : 'git' in parsed
                      ? { action: parsed.git.action, ...('path' in parsed.git ? { path: parsed.git.path } : {}) }
                      : {}),
        ...('to' in parsed ? { to: parsed.to } : {}),
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
      });
      return { data };
    } catch (error: unknown) {
      return this.toFailure(error);
    }
  }

  /**
   * Copies one file out of the root to `destination`, streaming it, and
   * answers the way `dispatch` does.
   *
   * Not a command: `destination` is a path *outside* the root, so it must never
   * come from a renderer. The desktop shell calls this with the path the user
   * picked in its own native Save dialog — the one way a download leaves the
   * app there. A copy that fails or is aborted leaves nothing behind.
   */
  async saveCopy(
    path: string,
    destination: string,
    options: FsSaveCopyOptions = {},
    session: FsBridgeSession = FileSystemBridge.openSession(),
  ): Promise<FsBridgeResponse<{ readonly bytes: number }>> {
    try {
      this.assertSignedIn(session);
      const target = await this.files.resolveDownload(path);
      let loaded = 0;
      const report = options.onProgress;

      try {
        await pipeline(
          createReadStream(target.absolutePath),
          async function* count(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
            for await (const chunk of source) {
              loaded += chunk.length;
              report?.(loaded, target.size);
              yield chunk;
            }
          },
          createWriteStream(destination),
          ...(options.signal === undefined ? [] : [{ signal: options.signal }]),
        );
      } catch (error) {
        await rm(destination, { force: true });
        throw options.signal?.aborted ? FileSystemBridge.aborted('The download was cancelled.') : error;
      }

      this.logger.debug('saved copy', { path, bytes: loaded });
      return { data: { bytes: loaded } };
    } catch (error: unknown) {
      return this.toFailure(error);
    }
  }

  /**
   * Streams a zip of `paths` to `destination` — how a folder, or a
   * selection, is downloaded on the desktop (PRD 003, §6) — answering the
   * way `saveCopy` does, and for the same reason not a command. `onProgress`
   * counts the bytes of the files read; the total is not known ahead.
   */
  async saveZip(
    paths: readonly string[],
    destination: string,
    options: FsSaveCopyOptions = {},
    session: FsBridgeSession = FileSystemBridge.openSession(),
  ): Promise<FsBridgeResponse<{ readonly bytes: number }>> {
    try {
      this.assertSignedIn(session);
      const zip = await this.archives.zipSources(paths);
      const output = createWriteStream(destination);
      let loaded = 0;
      try {
        await this.archives.writeZip(zip, output, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          onBytes: (bytes) => {
            loaded += bytes;
            options.onProgress?.(loaded, 0);
          },
        });
      } catch (error) {
        output.destroy();
        await rm(destination, { force: true });
        throw options.signal?.aborted ? FileSystemBridge.aborted('The download was cancelled.') : error;
      }
      this.logger.debug('saved zip', { paths: paths.length, bytes: loaded });
      return { data: { bytes: loaded } };
    } catch (error: unknown) {
      return this.toFailure(error);
    }
  }

  /**
   * Where an entry is on this machine, answered the way `dispatch` does —
   * for the desktop shell to open it with the system's default app or show
   * it in the system's file manager (PRD 003, §5).
   *
   * Not a command, for the reason `saveCopy` is not: the answer is a host
   * path, which is the main process's business and never the renderer's. The
   * same sign-in, resolver and root confinement as every command apply, and
   * an entry that is not there is a `404`.
   */
  async localPath(
    path: string,
    session: FsBridgeSession = FileSystemBridge.openSession(),
  ): Promise<FsBridgeResponse<FsLocalPath>> {
    try {
      this.assertSignedIn(session);
      return { data: await this.files.localPath(path) };
    } catch (error: unknown) {
      return this.toFailure(error);
    }
  }

  /**
   * Where host paths are in the root, answered the way `dispatch` does: each
   * one's root-relative path, or `null` for one outside the root or not there
   * (PRD 003, §6). For the desktop shell, which is handed host paths by the
   * system — files copied in another file manager, files dropped on the
   * window — and must say which of them this root can reach.
   *
   * Not a command either: the paths come from the operating system, never
   * from a renderer, and the answer is only what a listing would show.
   */
  async fromLocalPaths(
    absolute: readonly string[],
    session: FsBridgeSession = FileSystemBridge.openSession(),
  ): Promise<FsBridgeResponse<readonly (string | null)[]>> {
    try {
      this.assertSignedIn(session);
      return { data: await Promise.all(absolute.map((path) => this.files.fromLocalPath(path))) };
    } catch (error: unknown) {
      return this.toFailure(error);
    }
  }

  private async run(request: FsBridgeRequest, session: FsBridgeSession): Promise<unknown> {
    switch (request.command) {
      case 'auth-status':
        return this.statusOf(session);
      case 'login':
        session.username = null;
        await this.auth.signIn(request.username, request.password, 'bridge');
        session.username = request.username;
        return this.statusOf(session);
      case 'logout':
        session.username = null;
        return this.statusOf(session);
      default:
        break;
    }

    this.assertSignedIn(session);
    switch (request.command) {
      case 'list':
        return (await this.files.listDirectory(request.path)).toJSON();
      case 'list-progress':
        return this.files.listProgress(request.token, request.namesFrom, request.detailsFrom);
      case 'list-cancel':
        this.files.cancelListing(request.token);
        return { cancelled: true };
      case 'details':
        return (await this.files.getDetails(request.path, { recount: request.recount === true })).toJSON();
      case 'read':
        return this.read(request);
      case 'upload-begin':
        return this.beginUpload(request);
      case 'upload-chunk':
        return this.writeChunk(request);
      case 'upload-commit':
        return (await this.commitUpload(request.uploadId)).toJSON();
      case 'upload-abort':
        await this.abortUpload(request.uploadId);
        return { aborted: true };
      case 'op-info':
        return this.operations.info;
      case 'op-copy':
      case 'op-move':
        return this.operations.start({
          kind: request.command === 'op-copy' ? 'copy' : 'move',
          sources: request.sources,
          destination: request.destination,
          conflict: request.conflict,
          ...(request.errors === undefined ? {} : { errors: request.errors }),
        });
      case 'op-trash':
        return this.operations.start({ kind: 'trash', paths: request.paths, ...(request.errors === undefined ? {} : { errors: request.errors }) });
      case 'op-empty-trash':
        return this.operations.start({ kind: 'empty-trash' });
      case 'op-status':
        return this.operations.status(request.jobId);
      case 'op-cancel':
        return this.operations.cancel(request.jobId);
      case 'op-resolve':
        return this.operations.resolve(request.jobId, request.decision);
      case 'op-trash-list':
        return this.operations.trashListing();
      case 'op-delete':
        return this.operations.start({ kind: 'delete', paths: request.paths, ...(request.errors === undefined ? {} : { errors: request.errors }) });
      case 'op-restore':
        return this.operations.start({ kind: 'restore', ids: request.ids, ...(request.errors === undefined ? {} : { errors: request.errors }) });
      case 'rename':
        return (await this.files.rename(request.path, request.to)).toJSON();
      case 'mkdir':
        return (await this.files.createFolder(request.path, request.name)).toJSON();
      case 'create-file':
        return (await this.files.createFile(request.path, request.name)).toJSON();
      case 'search':
        return (await this.files.search(request.path, request.query, request.limit)).toJSON();
      case 'watch':
        return this.watches.watch(request.watchId, request.paths);
      case 'places':
        return this.placesService.places();
      case 'archive-list':
        return this.archives.list(request.path, request.inner);
      case 'op-compress':
        return this.operations.start({
          kind: 'compress',
          sources: request.sources,
          destination: request.destination,
          name: request.name,
          conflict: request.conflict,
        });
      case 'op-extract':
        return this.operations.start({
          kind: 'extract',
          path: request.path,
          destination: request.destination,
          conflict: request.conflict,
        });
      case 'git':
        return this.git.handle(request.git);
      case 'host-paths':
        return { paths: this.files.hostPaths(request.paths) };
      case 'time':
        return serverTime();
    }
  }

  /**
   * Reads one chunk of a file, refusing anything past `maxBytes` *before* the
   * read rather than after it — the caller knows the size from the listing and
   * says what it is willing to hold.
   */
  private async read(request: FsReadRequest): Promise<FsReadResult> {
    const target = await this.files.resolveDownload(request.path);
    const limit = request.maxBytes;

    if (limit !== undefined && target.size > limit) {
      throw HttpError.payloadTooLarge(
        `File is larger than the ${limit} byte limit`,
        { size: target.size },
      );
    }

    const offset = request.offset ?? 0;
    if (offset > target.size) {
      throw HttpError.badRequest(`Offset ${offset} is past the end of the file`);
    }
    const length = Math.min(request.length ?? FS_BRIDGE_CHUNK_BYTES, FS_BRIDGE_CHUNK_BYTES, target.size - offset);

    // `Buffer.alloc` never hands out a slice of Node's shared pool, so the
    // `ArrayBuffer` a structured clone copies is this chunk and nothing else.
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    if (length > 0) {
      const handle = await open(target.absolutePath, 'r');
      try {
        ({ bytesRead } = await handle.read(buffer, 0, length, offset));
      } finally {
        await handle.close();
      }
    }

    return {
      path: request.path,
      name: target.name,
      size: target.size,
      mimeType: target.mimeType,
      offset,
      // A plain view over the buffer: `Buffer` is a `Uint8Array`, but only the
      // latter survives a structured clone as itself.
      content: new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead),
    };
  }

  /**
   * Accepts an upload, refusing up front what `prepareUpload` refuses, and
   * starts `storeUpload` draining a stream the chunks will be written into —
   * so `saveUpload`'s write-to-temp-then-rename holds here exactly as over
   * HTTP, as does its size ceiling.
   */
  private async beginUpload(request: FsUploadBeginRequest): Promise<FsUploadBeginResult> {
    const prepared = await this.files.prepareUpload({
      directoryPath: request.path,
      filename: request.filename,
      overwrite: request.overwrite,
    });

    const uploadId = randomUUID();
    const stream = new PassThrough();
    // `storeUpload`'s pipeline reports a failure through `done`; a destroyed
    // stream must not also raise an unhandled `error` event.
    stream.on('error', () => undefined);

    const session: UploadSession = {
      stream,
      done: this.files.storeUpload(prepared, stream),
      received: 0,
      timer: this.idleTimer(uploadId),
    };
    session.done.catch((error: unknown) => {
      session.failure = error;
    });

    this.uploads.set(uploadId, session);
    return { uploadId };
  }

  /** Writes one chunk, waiting for the disk to catch up before answering. */
  private async writeChunk(request: FsUploadChunkRequest): Promise<{ readonly received: number }> {
    const session = this.session(request.uploadId);
    if (request.content.byteLength > FS_BRIDGE_CHUNK_BYTES) {
      throw HttpError.badRequest(`A chunk may carry at most ${FS_BRIDGE_CHUNK_BYTES} bytes`);
    }
    this.throwIfFailed(request.uploadId, session);

    const chunk = Buffer.from(request.content.buffer, request.content.byteOffset, request.content.byteLength);
    if (!session.stream.write(chunk)) {
      // Backpressure: answer once the chunk is on its way to disk, or once
      // storing has failed — never leave the caller waiting on a dead stream.
      await Promise.race([once(session.stream, 'drain').catch(() => undefined), session.done.catch(() => undefined)]);
    }
    this.throwIfFailed(request.uploadId, session);

    session.received += chunk.length;
    return { received: session.received };
  }

  private async commitUpload(uploadId: string): Promise<FileDetails> {
    const session = this.session(uploadId);
    session.stream.end();
    try {
      return await session.done;
    } finally {
      this.forget(uploadId);
    }
  }

  /** Stops an upload and lets `storeUpload` discard what it wrote. Idempotent. */
  private async abortUpload(uploadId: string): Promise<void> {
    const session = this.uploads.get(uploadId);
    if (!session) {
      return;
    }
    this.forget(uploadId);
    session.stream.destroy(FileSystemBridge.aborted('The upload was cancelled.'));
    await session.done.catch(() => undefined);
  }

  private session(uploadId: string): UploadSession {
    const session = this.uploads.get(uploadId);
    if (!session) {
      throw HttpError.notFound(`No upload in progress with id ${uploadId}`);
    }
    clearTimeout(session.timer);
    session.timer = this.idleTimer(uploadId);
    return session;
  }

  /** A failed upload is over: its session goes, and its reason is the answer. */
  private throwIfFailed(uploadId: string, session: UploadSession): void {
    if (session.failure !== undefined) {
      this.forget(uploadId);
      throw session.failure;
    }
  }

  private forget(uploadId: string): void {
    const session = this.uploads.get(uploadId);
    if (session) {
      clearTimeout(session.timer);
      this.uploads.delete(uploadId);
    }
  }

  /** A renderer that vanished mid-upload must not keep a temp file open forever. */
  private idleTimer(uploadId: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.logger.warn('abandoned upload aborted', { uploadId });
      void this.abortUpload(uploadId);
    }, UPLOAD_IDLE_MS);
    timer.unref?.();
    return timer;
  }

  /**
   * The bridge keeps no tokens: a connection is signed in by `login` itself,
   * so the session only has to remember who — and forgets on `logout`.
   */
  private statusOf(session: FsBridgeSession) {
    if (!this.auth.required) {
      return this.auth.status(undefined);
    }
    return { required: true, authenticated: session.username !== null, username: session.username };
  }

  private assertSignedIn(session: FsBridgeSession): void {
    if (this.auth.required && session.username === null) {
      throw HttpError.unauthorized('Sign in to continue');
    }
  }

  private static aborted(message: string): HttpError {
    return new HttpError(0, 'ABORTED', message);
  }

  /** A thrown error as the flattened failure a caller gets; see rule 2 above. */
  toFailure(error: unknown): FsBridgeFailure {
    if (error instanceof HttpError) {
      return {
        error: {
          code: error.code,
          message: error.message,
          status: error.status,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
    }

    this.logger.error('bridge command failed', {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    });

    return {
      error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', status: 500 },
    };
  }

  /**
   * Narrows an untrusted value to a request, rejecting with the same
   * `BAD_REQUEST` an HTTP caller would have received for a malformed query.
   * Public so a client speaking the same commands to a remote server (the
   * desktop's `RemoteBackend`, PRD 006) validates them exactly as this does.
   */
  static parse(value: unknown): FsBridgeRequest {
    if (typeof value !== 'object' || value === null) {
      throw HttpError.badRequest('A bridge request must be an object');
    }

    const { command } = value as { command?: unknown };

    switch (command) {
      case 'auth-status':
      case 'logout':
        return { command };
      case 'login':
        return {
          command,
          username: FileSystemBridge.readString(value, 'username'),
          password: FileSystemBridge.readString(value, 'password'),
        };
      case 'list':
        return { command, path: FileSystemBridge.readString(value, 'path') };
      case 'details':
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          ...((value as { recount?: unknown }).recount === true ? { recount: true } : {}),
        };
      case 'list-cancel':
        return { command, token: FileSystemBridge.readString(value, 'token') };
      case 'list-progress': {
        const cursors = {
          namesFrom: FileSystemBridge.readOptionalCount(value, 'namesFrom'),
          detailsFrom: FileSystemBridge.readOptionalCount(value, 'detailsFrom'),
        };
        return {
          command,
          token: FileSystemBridge.readString(value, 'token'),
          ...Object.fromEntries(Object.entries(cursors).filter(([, count]) => count !== undefined)),
        };
      }
      case 'read': {
        const optional = {
          offset: FileSystemBridge.readOptionalCount(value, 'offset'),
          length: FileSystemBridge.readOptionalCount(value, 'length'),
          maxBytes: FileSystemBridge.readOptionalCount(value, 'maxBytes'),
        };
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          ...Object.fromEntries(Object.entries(optional).filter(([, count]) => count !== undefined)),
        };
      }
      case 'upload-begin':
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          filename: FileSystemBridge.readString(value, 'filename'),
          overwrite: (value as { overwrite?: unknown }).overwrite === true,
        };
      case 'upload-chunk':
        return {
          command,
          uploadId: FileSystemBridge.readString(value, 'uploadId'),
          content: FileSystemBridge.readContent(value),
        };
      case 'upload-commit':
      case 'upload-abort':
        return { command, uploadId: FileSystemBridge.readString(value, 'uploadId') };
      case 'op-info':
      case 'op-empty-trash':
      case 'places':
      case 'time':
      case 'op-trash-list':
        return { command };
      case 'archive-list':
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          inner: FileSystemBridge.readString(value, 'inner'),
        };
      case 'op-compress': {
        const parsed = parseOperationRequest('compress', value);
        if (parsed.kind !== 'compress') {
          throw HttpError.internal();
        }
        return { command, sources: parsed.sources, destination: parsed.destination, name: parsed.name, conflict: parsed.conflict };
      }
      case 'op-extract': {
        const parsed = parseOperationRequest('extract', value);
        if (parsed.kind !== 'extract') {
          throw HttpError.internal();
        }
        return { command, path: parsed.path, destination: parsed.destination, conflict: parsed.conflict };
      }
      case 'op-copy':
      case 'op-move': {
        const parsed = parseOperationRequest(command === 'op-copy' ? 'copy' : 'move', value);
        if (parsed.kind !== 'copy' && parsed.kind !== 'move') {
          throw HttpError.internal();
        }
        return {
          command,
          sources: parsed.sources,
          destination: parsed.destination,
          conflict: parsed.conflict,
          ...(parsed.errors === undefined ? {} : { errors: parsed.errors }),
        };
      }
      case 'op-trash': {
        const parsed = parseOperationRequest('trash', value);
        return parsed.kind === 'trash' ? { command, paths: parsed.paths, ...(parsed.errors === undefined ? {} : { errors: parsed.errors }) } : { command, paths: [] };
      }
      case 'op-status':
      case 'op-cancel':
        return { command, jobId: FileSystemBridge.readString(value, 'jobId') };
      case 'op-resolve':
        return { command, jobId: FileSystemBridge.readString(value, 'jobId'), decision: parseDecision(value) };
      case 'op-delete': {
        const parsed = parseOperationRequest('delete', value);
        return parsed.kind === 'delete' ? { command, paths: parsed.paths, ...(parsed.errors === undefined ? {} : { errors: parsed.errors }) } : { command, paths: [] };
      }
      case 'op-restore': {
        const parsed = parseOperationRequest('restore', value);
        return parsed.kind === 'restore' ? { command, ids: parsed.ids, ...(parsed.errors === undefined ? {} : { errors: parsed.errors }) } : { command, ids: [] };
      }
      case 'rename':
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          to: FileSystemBridge.readString(value, 'to'),
        };
      case 'mkdir':
      case 'create-file':
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          name: FileSystemBridge.readString(value, 'name'),
        };
      case 'search': {
        const limit = FileSystemBridge.readOptionalCount(value, 'limit');
        return {
          command,
          path: FileSystemBridge.readString(value, 'path'),
          query: FileSystemBridge.readString(value, 'query'),
          ...(limit === undefined ? {} : { limit }),
        };
      }
      case 'host-paths':
        return { command, paths: FileSystemBridge.readStrings(value, 'paths') };
      case 'git': {
        const action = (value as { action?: unknown }).action;
        if (!isGitAction(action)) {
          throw HttpError.badRequest(`Unknown git action: ${String(action)}`);
        }
        return { command, git: parseGitRequest(action, value) };
      }
      case 'watch': {
        const watchId = (value as { watchId?: unknown }).watchId ?? null;
        if (watchId !== null && typeof watchId !== 'string') {
          throw HttpError.badRequest('Bridge request field "watchId" must be a string or null');
        }
        const paths = FileSystemBridge.readStrings(value, 'paths');
        if (paths.length > WATCH_MAX_PATHS) {
          throw HttpError.badRequest(`At most ${WATCH_MAX_PATHS} folders can be watched at once`);
        }
        return { command, watchId, paths };
      }
      default:
        throw HttpError.badRequest(`Unknown bridge command: ${String(command)}`);
    }
  }

  private static readString(value: object, field: string): string {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== 'string') {
      throw HttpError.badRequest(`Bridge request field "${field}" must be a string`);
    }
    return raw;
  }

  private static readStrings(value: object, field: string): string[] {
    const raw = (value as Record<string, unknown>)[field];
    if (!Array.isArray(raw) || !raw.every((item): item is string => typeof item === 'string')) {
      throw HttpError.badRequest(`Bridge request field "${field}" must be an array of strings`);
    }
    return raw;
  }

  private static readOptionalCount(value: object, field: string): number | undefined {
    const raw = (value as Record<string, unknown>)[field];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      throw HttpError.badRequest(`Bridge request field "${field}" must be a non-negative integer`);
    }
    return raw;
  }

  private static readContent(value: object): Uint8Array {
    const raw = (value as { content?: unknown }).content;
    if (raw instanceof Uint8Array) {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return new Uint8Array(raw);
    }
    throw HttpError.badRequest('Bridge request field "content" must be binary data');
  }
}
