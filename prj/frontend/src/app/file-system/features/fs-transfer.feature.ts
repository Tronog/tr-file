import type { FileSystemService } from '../file-system.service';
import type { FsDownload, FsUpload } from '../file-system.model';
import { FsError } from '../fs-error';
import type { FsUploadOptions } from '../fs-transport';

export type { FsUploadOptions };

/**
 * Moving bytes: files out of the backend and files into it.
 *
 * The feature itself is stateless. `upload()` returns a small handle that owns
 * that one upload's progress signal, promise and cancellation, so any number
 * of uploads can be in flight at once without sharing anything.
 *
 * What none of it knows is *how* the bytes travel. Over HTTP that is the
 * `/api/fs/download` and `/api/fs/upload` endpoints; on the desktop it is IPC
 * straight into the backend (PRD 001, §8.1), a chunk at a time (PRD 003, §1).
 */
export class FsTransferFeature {
  constructor(private readonly parent: FileSystemService) {}

  /**
   * Saves a file to the user's disk, as `name`: handed to the browser over
   * HTTP, streamed by the main process on the desktop. Either way the handle
   * reports how it went, so the Transfers panel can show it.
   */
  save(path: string, name: string): FsDownload {
    return this.parent.transport.save(path, name);
  }

  /** Saves a folder, or a selection, as one zip `name` (PRD 003, §6). */
  saveZip(paths: readonly string[], name: string): FsDownload {
    return this.parent.transport.saveZip(paths, name);
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
   * reports progress through `handle.progress` — on either transport a real
   * curve, since the desktop sends the file in chunks too.
   */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload {
    return this.parent.transport.upload(directoryPath, file, options);
  }
}
