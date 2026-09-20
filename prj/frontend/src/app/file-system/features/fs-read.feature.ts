import { HttpParams, httpResource, type HttpResourceRef } from '@angular/common/http';
import type { Signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { FileSystemService } from '../file-system.service';
import type { FsDetails, FsDirectoryListing, FsEnvelope } from '../file-system.model';
import { FsError } from '../fs-error';

/**
 * Reading the file system: directory listings and entry details.
 *
 * Offers each endpoint twice. The imperative `list()`/`details()` are for
 * one-shot work (a command, a guard, a test) and reject with `FsError`. The
 * `…Resource()` readers are for rendering: they follow a signal, re-fetch when
 * it changes and stay idle while it is `undefined`, so a caller can bind them
 * straight to a selection that may not exist yet.
 */
export class FsReadFeature {
  constructor(private readonly parent: FileSystemService) {}

  /* -- imperative -------------------------------------------------------- */

  /** Lists a directory. `''` is the configured files root. */
  async list(path: string): Promise<FsDirectoryListing> {
    return this.get<FsDirectoryListing>('list', path);
  }

  /** Describes one file or directory in full. */
  async details(path: string): Promise<FsDetails> {
    return this.get<FsDetails>('details', path);
  }

  /* -- reactive ---------------------------------------------------------- */

  /**
   * A directory listing that follows `path`.
   *
   * Idle (no request at all) while `path()` is `undefined`; the caller reads
   * `.value()`, `.isLoading()` and `.error()`.
   */
  listResource(path: Signal<string | undefined>): HttpResourceRef<FsDirectoryListing | undefined> {
    return this.resource<FsDirectoryListing>('list', path);
  }

  /** Entry details that follow `path`, idle while it is `undefined`. */
  detailsResource(path: Signal<string | undefined>): HttpResourceRef<FsDetails | undefined> {
    return this.resource<FsDetails>('details', path);
  }

  /* -- internals --------------------------------------------------------- */

  /**
   * The URL of one read endpoint for one path.
   *
   * `HttpParams` does the encoding, and the result is handed to `HttpClient`
   * as a whole URL — never re-encoded, so a path with spaces or `#` survives.
   */
  private url(endpoint: 'list' | 'details', path: string): string {
    const params = new HttpParams().set('path', path);
    return `${this.parent.baseUrl}/${endpoint}?${params.toString()}`;
  }

  private async get<T>(endpoint: 'list' | 'details', path: string): Promise<T> {
    try {
      const response = await firstValueFrom(this.parent.http.get<FsEnvelope<T>>(this.url(endpoint, path)));
      return response.data;
    } catch (error) {
      throw FsError.from(error);
    }
  }

  private resource<T>(
    endpoint: 'list' | 'details',
    path: Signal<string | undefined>,
  ): HttpResourceRef<T | undefined> {
    return httpResource<T>(
      () => {
        const value = path();
        // `undefined` keeps the resource idle — no request is ever issued.
        return value === undefined ? undefined : this.url(endpoint, value);
      },
      {
        injector: this.parent.injector,
        // The wire shape is the `{ data }` envelope; callers want the payload.
        parse: (raw: unknown) => (raw as FsEnvelope<T>).data,
      },
    );
  }
}
