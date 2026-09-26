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

  /**
   * @param reserved Names directly in the root that belong to the server,
   *   not to its users — the server's trash (PRD 005, §1). No path into one
   *   resolves, and no listing shows it.
   */
  constructor(
    root: string,
    private readonly reserved: readonly string[] = [],
  ) {
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

    const relative = FilePathResolver.toPosix(relativePath(this.root, absolute));
    if (this.isReserved(relative)) {
      throw HttpError.forbidden('That folder belongs to the server');
    }
    return new ResolvedPath(absolute, relative);
  }

  /** Whether a root-relative path is, or is inside, one of the reserved names. */
  isReserved(relative: string): boolean {
    const first = relative.split('/', 1)[0] as string;
    return this.reserved.includes(first);
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
    // A link elsewhere in the root must not be a way into a reserved folder either.
    if (this.isReserved(FilePathResolver.toPosix(relativePath(this.root, real)))) {
      throw HttpError.forbidden('That folder belongs to the server');
    }
    return candidate;
  }

  /**
   * Root-relative POSIX form of an absolute host path, or `null` when that
   * path lies outside the root. Used for reporting symlink targets without
   * leaking host paths.
   */
  toRootRelative(absolute: string): string | null {
    const normalised = resolve(absolute);
    if (normalised !== this.root && !normalised.startsWith(this.root + sep)) {
      return null;
    }
    return FilePathResolver.toPosix(relativePath(this.root, normalised));
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
