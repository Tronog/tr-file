import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { randomUUID } from 'node:crypto';

import {
  FS_BRIDGE_CHUNK_BYTES,
  FileSystemBridge,
  type FsBridgeFailure,
  type FsBridgeRequest,
  type FsBridgeResponse,
  type FsSaveCopyOptions,
} from '@tr-file/backend/bridge';
import { HttpError, type Logger } from '@tr-file/backend/core';

/** Where a remote server is, and — optionally — who to sign in as. */
export interface RemoteEndpoint {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly user: string | null;
  /** Used to sign in once, while connecting; never kept. */
  readonly password: string | null;
}

/** What the window is told about a connection: never the password. */
export interface RemoteConnectionInfo {
  readonly connected: true;
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly user: string | null;
}

/** Must match the backend's `CSRF_HEADER`: the remote server refuses a write without it. */
const CSRF_HEADER = 'X-TR-File-Request';
const SESSION_COOKIE = 'tr_file_session';

/** An upload that has not been touched for this long is given up on, as the local bridge does. */
const UPLOAD_IDLE_MS = 60_000;

type Fetch = typeof fetch;

/** A failure on its way back to the window, in the bridge's own shape. */
class RemoteFailure extends Error {
  constructor(
    readonly failure: FsBridgeFailure['error'],
  ) {
    super(failure.message);
  }
}

/** One upload streaming to the remote server as a single multipart `POST`. */
interface RemoteUpload {
  /** Chunks waiting to be handed to the request body; `null` ends it. */
  readonly queue: (Uint8Array | null)[];
  /** Wakes the body when a chunk arrives. */
  wake: (() => void) | null;
  /** Resolves the chunk the body has taken, so the caller can send the next. */
  taken: (() => void) | null;
  readonly response: Promise<Response>;
  failure?: RemoteFailure;
  readonly controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A remote tr-file server, spoken to over its REST API (PRD 006, §1) — the
 * same `/api` the web version uses — from the desktop's main process.
 *
 * It answers the very commands the local `FileSystemBridge` answers, so the
 * window cannot tell which it has: the IPC channel just hands a window's
 * commands to this instead. Why the main process and not the page: a page
 * calling another origin needs CORS the server does not grant, would not send
 * its `SameSite=Strict` session cookie, and would be refused by its CSRF check.
 * Here there is no origin at all — the client keeps the session cookie itself
 * and sends the CSRF header like the web frontend does.
 *
 * - `read` asks for one chunk with an HTTP `Range`;
 * - an upload is one streamed multipart `POST`: `upload-begin` opens it,
 *   each `upload-chunk` feeds it, `upload-commit` ends it and reads the answer;
 * - `saveCopy` streams a download straight to the chosen file.
 *
 * Every failure comes back flattened, with the remote server's own code and
 * status, or `NETWORK_ERROR` when the server could not be reached.
 */
export class RemoteBackend {
  private cookie: string | null = null;
  private readonly uploads = new Map<string, RemoteUpload>();
  private readonly api: string;

  private constructor(
    private readonly endpoint: RemoteEndpoint,
    private readonly logger: Logger,
    private readonly fetchFn: Fetch,
  ) {
    const host = endpoint.host.includes(':') && !endpoint.host.startsWith('[') ? `[${endpoint.host}]` : endpoint.host;
    this.api = `${endpoint.scheme}://${host}:${endpoint.port}/api`;
  }

  /**
   * Checks that `endpoint` is a tr-file server and, when a user and password
   * are given, signs in. Resolves with the connection, or with why not.
   */
  static async connect(
    endpoint: RemoteEndpoint,
    logger: Logger,
    fetchFn: Fetch = fetch,
  ): Promise<RemoteBackend | FsBridgeFailure> {
    const remote = new RemoteBackend(endpoint, logger, fetchFn);
    try {
      const health = (await remote.json<{ status?: unknown }>('GET', '/health')) ?? {};
      if (health.status !== 'ok') {
        throw new RemoteFailure({
          code: 'NOT_A_SERVER',
          message: `${remote.name} answered, but not as a tr-file server.`,
          status: 0,
        });
      }
      if (endpoint.user !== null && endpoint.password !== null) {
        const status = await remote.json<{ required: boolean }>('GET', '/auth/session');
        if (status.required) {
          await remote.signIn(endpoint.user, endpoint.password);
        }
      }
      logger.info('connected to remote server', { server: remote.name });
      return remote;
    } catch (error) {
      return { error: RemoteBackend.flatten(error, remote.name) };
    }
  }

  /** `user@host:port`, for logs and messages. */
  get name(): string {
    return `${this.endpoint.user === null ? '' : `${this.endpoint.user}@`}${this.endpoint.host}:${this.endpoint.port}`;
  }

  get info(): RemoteConnectionInfo {
    const { scheme, host, port, user } = this.endpoint;
    return { connected: true, scheme, host, port, user };
  }

  /** Runs one bridge command against the remote server. Never throws. */
  async dispatch(request: unknown): Promise<FsBridgeResponse> {
    try {
      return { data: await this.run(FileSystemBridge.parse(request)) };
    } catch (error) {
      return { error: RemoteBackend.flatten(error, this.name) };
    }
  }

  /**
   * Streams one remote file to `destination` — a path the user picked in the
   * native Save dialog — reporting progress. A copy that fails or is aborted
   * leaves nothing behind.
   */
  async saveCopy(
    path: string,
    destination: string,
    options: FsSaveCopyOptions = {},
  ): Promise<FsBridgeResponse<{ readonly bytes: number }>> {
    try {
      const response = await this.request('GET', '/fs/download', {
        query: { path },
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const total = Number(response.headers.get('content-length') ?? 0);
      let loaded = 0;
      const report = options.onProgress;
      const count = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          loaded += chunk.length;
          report?.(loaded, total || loaded);
          done(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(response.body as unknown as WebReadableStream),
          count,
          createWriteStream(destination),
          ...(options.signal ? [{ signal: options.signal }] : []),
        );
      } catch (error) {
        await rm(destination, { force: true });
        throw options.signal?.aborted
          ? new RemoteFailure({ code: 'ABORTED', message: 'The download was cancelled.', status: 0 })
          : error;
      }
      return { data: { bytes: loaded } };
    } catch (error) {
      return { error: RemoteBackend.flatten(error, this.name) };
    }
  }

  /** Stops every upload in flight; the connection is being dropped. */
  dispose(): void {
    for (const id of [...this.uploads.keys()]) {
      this.abortUpload(id);
    }
  }

  /* -- commands ------------------------------------------------------------ */

  private async run(request: FsBridgeRequest): Promise<unknown> {
    switch (request.command) {
      case 'list':
        return this.json('GET', '/fs/list', { query: { path: request.path } });
      case 'details':
        return this.json('GET', '/fs/details', { query: { path: request.path } });
      case 'read':
        return this.read(request.path, request.offset ?? 0, request.length, request.maxBytes);
      case 'upload-begin':
        return this.beginUpload(request.path, request.filename, request.overwrite);
      case 'upload-chunk':
        return this.writeChunk(request.uploadId, request.content);
      case 'upload-commit':
        return this.commitUpload(request.uploadId);
      case 'upload-abort':
        this.abortUpload(request.uploadId);
        return { aborted: true };
      case 'auth-status':
        return this.json('GET', '/auth/session');
      case 'login':
        return this.signIn(request.username, request.password);
      case 'logout': {
        const status = await this.json('POST', '/auth/logout', { body: {} });
        this.cookie = null;
        return status;
      }
      // File operations run on the server (PRD 005, §1); the window polls them through here.
      case 'op-info':
        return this.json('GET', '/ops/info');
      case 'op-copy':
      case 'op-move':
        return this.json('POST', request.command === 'op-copy' ? '/ops/copy' : '/ops/move', {
          body: { sources: request.sources, destination: request.destination, conflict: request.conflict },
          accept: [202],
        });
      case 'op-trash':
        return this.json('POST', '/ops/trash', { body: { paths: request.paths }, accept: [202] });
      case 'op-empty-trash':
        return this.json('POST', '/ops/empty-trash', { body: {}, accept: [202] });
      case 'op-status':
        return this.json('GET', `/ops/jobs/${encodeURIComponent(request.jobId)}`);
      case 'op-cancel':
        return this.json('POST', `/ops/jobs/${encodeURIComponent(request.jobId)}/cancel`, { body: {} });
    }
  }

  /**
   * One chunk, by `Range`. The size of the whole file comes from
   * `Content-Range`, so a file past `maxBytes` is refused before its bytes
   * are read; an empty file answers `416` and is an empty chunk.
   */
  private async read(path: string, offset: number, length: number | undefined, maxBytes: number | undefined) {
    const span = Math.min(length ?? FS_BRIDGE_CHUNK_BYTES, FS_BRIDGE_CHUNK_BYTES);
    const response = await this.request('GET', '/fs/download', {
      query: { path },
      headers: { Range: `bytes=${offset}-${offset + Math.max(span, 1) - 1}` },
      accept: [200, 206, 416],
    });

    const range = response.headers.get('content-range') ?? '';
    const total = Number(/\/(\d+)$/.exec(range)?.[1] ?? response.headers.get('content-length') ?? 0);
    if (maxBytes !== undefined && total > maxBytes) {
      await response.body?.cancel();
      throw new RemoteFailure({
        code: 'PAYLOAD_TOO_LARGE',
        message: `File is larger than the ${maxBytes} byte limit`,
        status: 413,
      });
    }

    let content = response.status === 416 ? new Uint8Array(0) : new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) {
      // A server that ignored the range sent it all: keep only the chunk asked for.
      content = content.slice(offset, offset + span);
    }
    const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
    return {
      path,
      name: path.split('/').at(-1) ?? path,
      size: total,
      mimeType: type === 'application/octet-stream' ? null : type,
      offset,
      content,
    };
  }

  /**
   * Opens an upload. The remote server only answers once the whole body has
   * arrived, so a name that is taken is checked for first — or the window
   * would learn of the conflict only after sending the entire file.
   */
  private async beginUpload(directory: string, filename: string, overwrite: boolean) {
    if (!overwrite) {
      const target = directory === '' ? filename : `${directory}/${filename}`;
      const existing = await this.request('GET', '/fs/details', { query: { path: target }, accept: [200, 404] });
      await existing.body?.cancel();
      if (existing.status === 200) {
        throw new RemoteFailure({ code: 'CONFLICT', message: `Target already exists: ${target}`, status: 409 });
      }
    }

    const uploadId = randomUUID();
    const boundary = `----tr-file-${uploadId}`;
    const safeName = filename.replace(/["\\\r\n]/g, '_');
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const controller = new AbortController();

    const upload: RemoteUpload = {
      queue: [],
      wake: null,
      taken: null,
      controller,
      timer: this.idleTimer(uploadId),
      response: undefined as unknown as Promise<Response>,
    };

    // The body hands each chunk over only as the request takes it, so a slow
    // network holds back the next `upload-chunk` rather than filling memory.
    async function* body(): AsyncGenerator<Uint8Array> {
      yield head;
      for (;;) {
        while (upload.queue.length === 0) {
          await new Promise<void>((wake) => (upload.wake = wake));
        }
        const chunk = upload.queue.shift() as Uint8Array | null;
        upload.taken?.();
        if (chunk === null) {
          break;
        }
        yield chunk;
      }
      yield tail;
    }

    const response = this.request('POST', '/fs/upload', {
      query: { path: directory, overwrite: overwrite ? 'true' : 'false' },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      rawBody: body(),
      signal: controller.signal,
      accept: [201],
    });
    // A server that answers before the body is done — a refusal — ends the upload.
    response.catch((error: unknown) => {
      upload.failure = error instanceof RemoteFailure ? error : new RemoteFailure(RemoteBackend.flatten(error, this.name));
      upload.taken?.();
    });
    (upload as { response: Promise<Response> }).response = response;
    this.uploads.set(uploadId, upload);
    return { uploadId };
  }

  private async writeChunk(uploadId: string, content: Uint8Array) {
    const upload = this.session(uploadId);
    if (content.byteLength > FS_BRIDGE_CHUNK_BYTES) {
      throw new RemoteFailure({
        code: 'BAD_REQUEST',
        message: `A chunk may carry at most ${FS_BRIDGE_CHUNK_BYTES} bytes`,
        status: 400,
      });
    }
    this.throwIfFailed(uploadId, upload);
    await new Promise<void>((resolve) => {
      upload.taken = resolve;
      upload.queue.push(content);
      upload.wake?.();
    });
    this.throwIfFailed(uploadId, upload);
    return { received: content.byteLength };
  }

  private async commitUpload(uploadId: string) {
    const upload = this.session(uploadId);
    upload.queue.push(null);
    upload.wake?.();
    try {
      const response = await upload.response;
      return ((await response.json()) as { data: unknown }).data;
    } finally {
      this.forget(uploadId);
    }
  }

  private abortUpload(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (upload !== undefined) {
      this.forget(uploadId);
      upload.controller.abort();
    }
  }

  private session(uploadId: string): RemoteUpload {
    const upload = this.uploads.get(uploadId);
    if (upload === undefined) {
      throw new RemoteFailure({ code: 'NOT_FOUND', message: `No upload in progress with id ${uploadId}`, status: 404 });
    }
    clearTimeout(upload.timer);
    upload.timer = this.idleTimer(uploadId);
    return upload;
  }

  private throwIfFailed(uploadId: string, upload: RemoteUpload): void {
    if (upload.failure !== undefined) {
      this.forget(uploadId);
      throw upload.failure;
    }
  }

  private forget(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (upload !== undefined) {
      clearTimeout(upload.timer);
      this.uploads.delete(uploadId);
    }
  }

  private idleTimer(uploadId: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.abortUpload(uploadId), UPLOAD_IDLE_MS);
    timer.unref?.();
    return timer;
  }

  private async signIn(username: string, password: string) {
    return this.json('POST', '/auth/login', { body: { username, password } });
  }

  /* -- HTTP ------------------------------------------------------------------ */

  private async json<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string>; body?: unknown; accept?: readonly number[] } = {},
  ): Promise<T> {
    const response = await this.request(method, path, options);
    return ((await response.json()) as { data: T }).data;
  }

  /**
   * One request: the session cookie and, for a write, the CSRF header go
   * with it; a new session cookie is kept; an answer outside `accept` is
   * turned into the server's own failure.
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
      rawBody?: AsyncIterable<Uint8Array>;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      accept?: readonly number[];
    } = {},
  ): Promise<Response> {
    const url = new URL(`${this.api}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (method !== 'GET') {
      headers[CSRF_HEADER] = '1';
    }
    if (this.cookie !== null) {
      headers['Cookie'] = `${SESSION_COOKIE}=${this.cookie}`;
    }
    let body: RequestInit['body'];
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    } else if (options.rawBody !== undefined) {
      body = options.rawBody as unknown as RequestInit['body'];
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(options.rawBody === undefined ? {} : { duplex: 'half' }),
        ...(options.signal ? { signal: options.signal } : {}),
        redirect: 'error',
      } as RequestInit);
    } catch (error) {
      if (options.signal?.aborted) {
        throw new RemoteFailure({ code: 'ABORTED', message: 'Cancelled.', status: 0 });
      }
      this.logger.warn('remote server unreachable', {
        server: this.name,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw new RemoteFailure({
        code: 'NETWORK_ERROR',
        message: `Could not reach ${this.name}: ${error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)}`,
        status: 0,
      });
    }

    this.keepCookie(response);
    const accepted = options.accept ?? [200];
    if (!accepted.includes(response.status)) {
      throw new RemoteFailure(await RemoteBackend.failureOf(response));
    }
    return response;
  }

  /** Keeps — or, on sign-out, forgets — the remote server's session cookie. */
  private keepCookie(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';');
      const [name, ...value] = (pair ?? '').trim().split('=');
      if (name !== SESSION_COOKIE) {
        continue;
      }
      const cleared = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute)) || value.join('=') === '';
      this.cookie = cleared ? null : value.join('=');
    }
  }

  /** The server's own `{ error: { code, message } }`, with the status it came with. */
  private static async failureOf(response: Response): Promise<FsBridgeFailure['error']> {
    try {
      const body = (await response.json()) as { error?: { code?: unknown; message?: unknown; details?: unknown } };
      if (typeof body.error?.code === 'string' && typeof body.error.message === 'string') {
        return {
          code: body.error.code,
          message: body.error.message,
          status: response.status,
          ...(body.error.details === undefined ? {} : { details: body.error.details }),
        };
      }
    } catch {
      // Not the contract's envelope — a proxy's error page, say.
    }
    return { code: 'UNKNOWN_ERROR', message: `The server answered ${response.status} ${response.statusText}`, status: response.status };
  }

  private static flatten(error: unknown, name: string): FsBridgeFailure['error'] {
    if (error instanceof RemoteFailure) {
      return error.failure;
    }
    // A command the shared validator refused, as the local bridge would.
    if (error instanceof HttpError) {
      return { code: error.code, message: error.message, status: error.status };
    }
    return {
      code: 'UNKNOWN_ERROR',
      message: `Talking to ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      status: 0,
    };
  }
}
