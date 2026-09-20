import type { FileSystemService } from '../file-system.service';
import type { FsDetails, FsDirectoryListing } from '../file-system.model';

/**
 * Reading the file system: directory listings and entry details.
 *
 * Both calls are one-shot and reject with `FsError`. Neither knows how the
 * backend is reached — since §8.1 that is the transport's business, and on the
 * desktop no HTTP is involved at all.
 *
 * The reactive `httpResource` readers that used to live here moved to
 * `FsHttpService`, where they belong: an `httpResource` is an HTTP thing, and
 * a feature that must work over both transports cannot offer one.
 */
export class FsReadFeature {
  constructor(private readonly parent: FileSystemService) {}

  /** Lists a directory. `''` is the configured files root. */
  async list(path: string): Promise<FsDirectoryListing> {
    return this.parent.transport.list(path);
  }

  /** Describes one file or directory in full. */
  async details(path: string): Promise<FsDetails> {
    return this.parent.transport.details(path);
  }
}
