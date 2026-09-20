import { HttpErrorResponse, HttpEventType, HttpParams, type HttpProgressEvent } from '@angular/common/http';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Subscription } from 'rxjs';
import type { FileSystemService } from '../file-system.service';
import type { FsDetails, FsEnvelope, FsUpload, FsUploadProgress } from '../file-system.model';
import { FS_ABORTED, FsError } from '../fs-error';

/** Options accepted by {@link FsTransferFeature.upload}. */
export interface FsUploadOptions {
  /** Replace an existing file instead of failing with `CONFLICT`. */
  readonly overwrite?: boolean;
}

const IDLE_PROGRESS: FsUploadProgress = { loaded: 0, total: null, percent: null };

/**
 * Moving bytes: downloads out of the backend and uploads into it.
 *
 * The feature itself is stateless. `upload()` returns a small handle that owns
 * that one upload's progress signal, promise and cancellation, so any number of
 * uploads can be in flight at once without sharing anything.
 */
export class FsTransferFeature {
  constructor(private readonly parent: FileSystemService) {}

  /**
   * The URL a browser can hit directly — an `<a href>`, `window.open`, an
   * `<img src>`. The backend sets `Content-Disposition: attachment`, so the
   * browser saves the file rather than navigating to it.
   */
  downloadUrl(path: string): string {
    const params = new HttpParams().set('path', path);
    return `${this.parent.baseUrl}/download?${params.toString()}`;
  }

  /**
   * Fetches a file's bytes, for in-app use (a preview, an editor buffer).
   *
   * A failed blob request carries the error envelope as a `Blob` too, so the
   * rejection is built asynchronously to recover the server's real error code.
   */
  async download(path: string): Promise<Blob> {
    try {
      return await firstValueFrom(
        this.parent.http.get(this.downloadUrl(path), { responseType: 'blob' }),
      );
    } catch (error) {
      throw error instanceof HttpErrorResponse
        ? await FsError.fromHttpResponse(error)
        : FsError.from(error);
    }
  }

  /**
   * Reads a file as text, for showing it rather than saving it.
   *
   * Goes through the same download endpoint — there is no separate content
   * route — and refuses anything past `maxBytes` so a preview can never pull a
   * gigabyte into memory. The caller decides what that limit is; it knows the
   * file's size from the listing.
   */
  async readText(path: string, maxBytes: number): Promise<string> {
    const blob = await this.download(path);
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
   * Returns immediately with a handle; the request runs in the background and
   * reports progress through `handle.progress`. Upload progress is why the app
   * keeps the XHR backend — see the comment in `app.config.ts`.
   */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload {
    const progress = signal<FsUploadProgress>(IDLE_PROGRESS);

    const body = new FormData();
    body.append('file', file, file.name);

    const params = new HttpParams()
      .set('path', directoryPath)
      .set('overwrite', options?.overwrite === true ? 'true' : 'false');
    const url = `${this.parent.baseUrl}/upload?${params.toString()}`;

    let subscription: Subscription | undefined;
    let settled = false;
    let fail: (error: FsError) => void = () => undefined;

    const result = new Promise<FsDetails>((resolve, reject) => {
      fail = (error: FsError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      subscription = this.parent.http
        .post<FsEnvelope<FsDetails>>(url, body, { reportProgress: true, observe: 'events' })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress) {
              progress.set(toProgress(event));
            } else if (event.type === HttpEventType.Response) {
              const envelope = event.body;
              if (!envelope) {
                fail(new FsError('The upload response carried no body.', event.status, 'UNKNOWN_ERROR'));
                return;
              }
              settled = true;
              resolve(envelope.data);
            }
          },
          error: (error: unknown) => fail(FsError.from(error)),
        });
    });

    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        // Unsubscribing aborts the underlying XHR; the promise then rejects so
        // no caller is left awaiting a request that will never answer.
        subscription?.unsubscribe();
        fail(new FsError('The upload was cancelled.', 0, FS_ABORTED));
      },
    };
  }
}

/** Maps an `HttpProgressEvent` onto the contract-free progress shape. */
function toProgress(event: HttpProgressEvent): FsUploadProgress {
  const total = event.total ?? null;
  return {
    loaded: event.loaded,
    total,
    percent: total && total > 0 ? Math.round((event.loaded / total) * 100) : null,
  };
}
