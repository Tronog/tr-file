import type { FileSystemService } from '../file-system.service';
import type { FsUpload } from '../file-system.model';
import { FsError } from '../fs-error';
import type { FsSaveUrl, FsUploadOptions } from '../fs-transport';

export type { FsUploadOptions };

/**
 * Moving bytes: files out of the backend and files into it.
 *
 * The feature itself is stateless. `upload()` returns a small handle that owns
 * that one upload's progress signal, promise and cancellation, so any number
 * of uploads can be in flight at once without sharing anything.
 *
 * What none of it knows is *how* the bytes travel. Over HTTP that is the
 * `/api/fs/download` and `/api/fs/upload` endpoints; on the desktop it is one
 * IPC command straight into the backend (PRD 001, §8.1).
 */
export class FsTransferFeature {
  constructor(private readonly parent: FileSystemService) {}

  /**
   * A URL the browser can stream to disk from, and the cleanup that goes with
   * it. The caller must `release()` when the save has been kicked off — over
   * HTTP that does nothing, on the desktop it revokes an object URL.
   */
  async saveUrl(path: string): Promise<FsSaveUrl> {
    return this.parent.transport.saveUrl(path);
  }

  /**
   * Fetches a file's bytes, for in-app use (a preview, an editor buffer).
   *
   * `maxBytes` is passed straight down: a transport that can refuse an
   * oversized file *before* reading it does, and one that cannot ignores it.
   * The caller checks what it got either way.
   */
  async download(path: string, maxBytes?: number): Promise<Blob> {
    return this.parent.transport.read(path, maxBytes);
  }

  /**
   * Reads a file as text, for showing it rather than saving it.
   *
   * `maxBytes` is passed down so a transport that can refuse an oversized file
   * before reading it does — the desktop one does — and checked again here, so
   * the limit holds identically on the transport that cannot. The caller
   * decides what the limit is; it knows the file's size from the listing.
   */
  async readText(path: string, maxBytes: number): Promise<string> {
    const blob = await this.parent.transport.read(path, maxBytes);
    if (blob.size > maxBytes) {
      throw new FsError(
        `File is larger than the ${maxBytes} byte preview limit`,
        413,
        'PAYLOAD_TOO_LARGE',
      );
    }
    return blob.text();
  }

  /**
   * Uploads one file into `directoryPath`.
   *
   * Returns immediately with a handle; the transfer runs in the background and
   * reports progress through `handle.progress`. Over HTTP that is a real
   * curve; on the desktop the bytes cross in one hand-off, so it is start and
   * finish only.
   */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload {
    return this.parent.transport.upload(directoryPath, file, options);
  }
}
