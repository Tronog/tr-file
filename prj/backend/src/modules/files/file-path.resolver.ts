import { realpath } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve, sep } from 'node:path';

import { HttpError } from '../../core/index.js';

/** A request path that has been proven to live inside the configured root. */
export class ResolvedPath {
  constructor(
    /** Absolute path on the host file system. */
    readonly absolute: string,
    /** Root-relative POSIX path; `''` denotes the root itself. */
    readonly relative: string,
  ) {}
}

/**
 * Translates untrusted, client-supplied paths into absolute paths that are
 * guaranteed to stay within `root`. Every file-system access must go through
 * this resolver.
 */
export class FilePathResolver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  get rootPath(): string {
    return this.root;
  }

  /** Lexical resolution: rejects traversal out of the root. */
  resolve(requested: string | undefined): ResolvedPath {
    const raw = (requested ?? '').trim();
    if (raw.includes('\0')) {
      throw HttpError.badRequest('Path must not contain null bytes');
    }

    // A leading separator is interpreted relative to the root, never the host FS.
    const cleaned = raw.replace(/^[/\\]+/, '');
    const absolute = resolve(this.root, cleaned);
    this.assertInsideRoot(absolute);

    return new ResolvedPath(absolute, FilePathResolver.toPosix(relativePath(this.root, absolute)));
  }

  /**
   * Lexical resolution plus a `realpath` check, so symlinks pointing outside
   * the root are rejected as well.
   */
  async resolveReal(requested: string | undefined): Promise<ResolvedPath> {
    const candidate = this.resolve(requested);
    let real: string;
    try {
      real = await realpath(candidate.absolute);
    } catch (error) {
      if (FilePathResolver.isErrnoException(error) && error.code === 'ENOENT') {
        return candidate;
      }
      throw error;
    }
    this.assertInsideRoot(real);
    return candidate;
  }

  private assertInsideRoot(absolute: string): void {
    if (!isAbsolute(absolute) || (absolute !== this.root && !absolute.startsWith(this.root + sep))) {
      throw HttpError.forbidden('Path escapes the configured files root');
    }
  }

  private static toPosix(value: string): string {
    return value.split(sep).join('/');
  }

  static isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
  }
}
