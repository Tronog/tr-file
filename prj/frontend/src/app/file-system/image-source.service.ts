import { Service, inject, signal } from '@angular/core';
import { FileSystemService } from './file-system.service';
import { FsError } from './fs-error';

/**
 * Extensions the browser can decode in an `<img>`.
 *
 * SVG is included: an `<img>` is the one context where it cannot run script,
 * so it is as inert here as a PNG.
 */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg',
]);

/**
 * Images get a far larger budget than text: a photograph is routinely several
 * megabytes, and nothing here walks the bytes — they go straight to the
 * browser.
 */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

type SourceStatus = 'loading' | 'ready' | 'error';

interface SourceState {
  readonly status: SourceStatus;
  /** An object URL this service made, and is therefore the one to revoke. */
  readonly url?: string;
  readonly error?: FsError;
}

/**
 * The file system, as pictures the browser can draw.
 *
 * One cache of object URLs keyed by path, so the same image opened in a panel
 * tab and selected in the details sidebar is fetched once and drawn twice
 * (PRD 001, §7.3.1 and §9). Whoever asks first pays; everyone else reads.
 *
 * It exists because the bytes cannot simply be pointed at: `/api/fs/download`
 * needs no ceremony in a browser, but the desktop build reaches the backend
 * over IPC and has no URL at all (§8.1). Both come back as a `Blob`, and a
 * `blob:` URL is the one thing an `<img>` understands either way.
 *
 * Nothing else can free those URLs, so this service is their owner: it revokes
 * one when it replaces it, and `release` exists for a caller that knows an
 * image will not be wanted again.
 */
@Service()
export class ImageSourceService {
  private readonly sources = signal<ReadonlyMap<string, SourceState>>(new Map());

  /** In-flight reads, so a second asker awaits the first rather than refetching. */
  private readonly pending = new Map<string, Promise<void>>();

  private readonly fileSystem = inject(FileSystemService);

  /** Whether a path names something an `<img>` can decode. */
  isImage(path: string): boolean {
    const name = path.split('/').at(-1) ?? path;
    const dot = name.lastIndexOf('.');
    return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
  }

  /** The URL for a path, or `undefined` until it has been read. */
  urlFor(path: string): string | undefined {
    return this.sources().get(path)?.url;
  }

  isLoading(path: string): boolean {
    return this.sources().get(path)?.status === 'loading';
  }

  /** Why the image could not be read, if it could not. */
  errorFor(path: string): FsError | undefined {
    return this.sources().get(path)?.error;
  }

  /**
   * Reads an image unless it is cached or already in flight, and resolves when
   * there is something to show — or something to say about why there is not.
   *
   * Started by an action — a selection, a tab opening — and never from a
   * `computed`, which would write signals during change detection.
   */
  load(path: string): Promise<void> {
    return this.pending.get(path) ?? (this.sources().has(path) ? Promise.resolve() : this.fetch(path));
  }

  /** Re-reads an image that is already cached (a Refresh). */
  reload(path: string): Promise<void> {
    return this.pending.get(path) ?? this.fetch(path);
  }

  /** Frees the URL for a path, if this service made one. */
  release(path: string): void {
    const url = this.sources().get(path)?.url;
    if (url === undefined) {
      return;
    }
    URL.revokeObjectURL(url);
    this.sources.update((cache) => {
      const next = new Map(cache);
      next.delete(path);
      return next;
    });
  }

  private fetch(path: string): Promise<void> {
    const read = this.read(path).finally(() => this.pending.delete(path));
    this.pending.set(path, read);
    return read;
  }

  private async read(path: string): Promise<void> {
    this.patch(path, { status: 'loading' });

    try {
      // `maxBytes` travels with the request so a transport that can refuse an
      // oversized file before reading it does; the check below covers the one
      // that cannot.
      const blob = await this.fileSystem.transferFt.download(path, MAX_IMAGE_BYTES);
      if (blob.size > MAX_IMAGE_BYTES) {
        throw new FsError(
          `Image is larger than the ${MAX_IMAGE_BYTES} byte preview limit`,
          413,
          'PAYLOAD_TOO_LARGE',
        );
      }
      this.patch(path, { status: 'ready', url: URL.createObjectURL(blob) });
    } catch (error) {
      this.patch(path, { status: 'error', error: FsError.from(error) });
    }
  }

  /** Replaces a state, releasing the URL the previous one held. */
  private patch(path: string, state: SourceState): void {
    const previous = this.sources().get(path)?.url;
    if (previous !== undefined && previous !== state.url) {
      URL.revokeObjectURL(previous);
    }
    this.sources.update((cache) => new Map(cache).set(path, state));
  }
}
