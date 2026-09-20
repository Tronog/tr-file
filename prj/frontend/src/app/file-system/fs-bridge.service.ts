import { Service, signal } from '@angular/core';
import type { FsDetails, FsDirectoryListing, FsUpload, FsUploadProgress } from './file-system.model';
import { FS_ABORTED, FsError } from './fs-error';
import type { FsSaveUrl, FsTransport, FsUploadOptions } from './fs-transport';

/**
 * What a bridge command answers with. Mirrors the backend's
 * `FsBridgeResponse`; kept as its own declaration rather than imported,
 * because the frontend must not depend on a Node package.
 */
type FsBridgeResponse<T> =
  | { readonly data: T }
  | {
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly status: number;
        readonly details?: unknown;
      };
    };

/** The object the Electron preload script exposes on `window`. */
interface FsBridgeApi {
  /** Contract version, so a stale preload can be recognised rather than used. */
  readonly version: number;
  invoke(request: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    /** Present only inside the desktop shell; see `prj/desktop`. */
    readonly trFileBridge?: FsBridgeApi;
  }
}

/** The contract version this service speaks. */
const BRIDGE_VERSION = 1;

/** What the file's bytes come back as. */
interface FsReadResult {
  readonly name: string;
  readonly size: number;
  readonly mimeType: string | null;
  /** Explicitly over a plain `ArrayBuffer`, which is what `Blob` accepts. */
  readonly content: Uint8Array<ArrayBuffer>;
}

/**
 * The desktop transport (PRD 001, §8.1): the backend, reached directly.
 *
 * Inside the Electron shell the API and the renderer are the same
 * application, so HTTP would mean serialising a request, framing it, sending
 * it through the loopback stack and parsing it again — all to reach an object
 * in the next process. This service skips that: each call is one structured
 * clone through an IPC channel into the very same `FilesService` the HTTP
 * routes use. `prj/desktop` owns the channel; the only thing the browser side
 * sees is `window.trFileBridge`, put there by a sandboxed preload.
 *
 * Two consequences are visible to callers, and both are deliberate:
 *
 * - **Errors still arrive as `FsError`,** with the same codes and the same
 *   status numbers HTTP would have produced. The backend flattens them into
 *   data precisely so this stays true; nothing above has to ask which
 *   transport failed.
 * - **Uploads report start and finish, not a curve.** The bytes cross the
 *   channel in one hand-off, so there is no streaming progress to observe.
 *   That is honest rather than approximate: a fake curve would be worse than
 *   none, and a local copy is near-instant anyway.
 */
@Service()
export class FsBridgeService implements FsTransport {
  readonly kind = 'desktop' as const;

  /** Whether this app is running inside the desktop shell at all. */
  get isAvailable(): boolean {
    return this.api !== undefined;
  }

  async list(path: string): Promise<FsDirectoryListing> {
    return this.invoke<FsDirectoryListing>({ command: 'list', path });
  }

  async details(path: string): Promise<FsDetails> {
    return this.invoke<FsDetails>({ command: 'details', path });
  }

  /**
   * Unlike HTTP, `maxBytes` is enforced *before* the file is read, so an
   * oversized preview never occupies memory on either side of the channel.
   */
  async read(path: string, maxBytes?: number): Promise<Blob> {
    const result = await this.invoke<FsReadResult>({
      command: 'read',
      path,
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });
    return new Blob([result.content], {
      ...(result.mimeType === null ? {} : { type: result.mimeType }),
    });
  }

  /**
   * There is no HTTP URL to hand the browser here, so the bytes are fetched
   * and wrapped in an object URL. `release` revokes it — which is why
   * `FsSaveUrl` carries a cleanup at all.
   */
  async saveUrl(path: string): Promise<FsSaveUrl> {
    const blob = await this.read(path);
    const url = URL.createObjectURL(blob);
    return { url, release: () => URL.revokeObjectURL(url) };
  }

  /**
   * Uploads one file by reading it and handing the bytes over in a single
   * command. The returned handle keeps the shape of the HTTP one so callers
   * are unchanged; `cancel` can only prevent the hand-off, since once the
   * command is in flight there is nothing to abort.
   */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload {
    const progress = signal<FsUploadProgress>({ loaded: 0, total: file.size, percent: 0 });

    let cancelled = false;
    let settled = false;
    let fail: (error: FsError) => void = () => undefined;

    const result = new Promise<FsDetails>((resolve, reject) => {
      fail = (error: FsError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      void (async () => {
        try {
          const content = new Uint8Array(await file.arrayBuffer());
          if (cancelled) {
            return;
          }

          const details = await this.invoke<FsDetails>({
            command: 'upload',
            path: directoryPath,
            filename: file.name,
            content,
            overwrite: options?.overwrite === true,
          });

          if (cancelled) {
            return;
          }
          progress.set({ loaded: file.size, total: file.size, percent: 100 });
          settled = true;
          resolve(details);
        } catch (error) {
          fail(FsError.from(error));
        }
      })();
    });

    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        cancelled = true;
        fail(new FsError('The upload was cancelled.', 0, FS_ABORTED));
      },
    };
  }

  /* -- internals ---------------------------------------------------------- */

  /** The preload's object, or `undefined` outside the desktop shell. */
  private get api(): FsBridgeApi | undefined {
    const api = globalThis.window?.trFileBridge;
    return api?.version === BRIDGE_VERSION ? api : undefined;
  }

  /**
   * Sends one command and unwraps its answer.
   *
   * Three failures are distinguished, because they mean different things: no
   * bridge at all (a programming error — this service was chosen in a
   * browser), the backend's own refusal (a real `FsError` with its code), and
   * a channel that threw (the main process died, or the payload would not
   * clone).
   */
  private async invoke<T>(request: object): Promise<T> {
    const api = this.api;
    if (api === undefined) {
      throw new FsError('The desktop bridge is not available.', 0, 'NETWORK_ERROR');
    }

    let response: unknown;
    try {
      response = await api.invoke(request);
    } catch (error) {
      throw FsError.from(error);
    }

    return FsBridgeService.unwrap<T>(response);
  }

  private static unwrap<T>(response: unknown): T {
    if (typeof response !== 'object' || response === null) {
      throw new FsError('The desktop bridge returned nothing usable.', 0, 'UNKNOWN_ERROR');
    }

    const answer = response as FsBridgeResponse<T>;
    if ('error' in answer) {
      throw FsError.fromBridge(answer.error);
    }
    return answer.data;
  }
}
