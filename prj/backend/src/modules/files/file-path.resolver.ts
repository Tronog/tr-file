import { realpath } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve, sep, win32 } from 'node:path';

import { HttpError } from '../../core/index.js';

/** A request path that has been proven to live inside the configured root. */
export class ResolvedPath {
  constructor(
    /**
     * Absolute path on the host file system. `''` for the root of a
     * `FilePathResolver.drives()` resolver, which is no folder at all but the
     * list of drives — any file-system call on it fails with `ENOENT`.
     */
    readonly absolute: string,
    /** Root-relative POSIX path; `''` denotes the root itself. */
    readonly relative: string,
  ) {}
}

/** `C:` — one path segment naming a Windows drive. */
const DRIVE_SEGMENT = /^[A-Za-z]:$/;

/**
 * Translates untrusted, client-supplied paths into absolute paths that are
 * guaranteed to stay within `root`. Every file-system access must go through
 * this resolver.
 *
 * The root is one folder — on a server, the files root; on the desktop, since
 * PRD 003 §6, usually the whole file system: `/`. Windows has no one root, so
 * there the desktop uses `FilePathResolver.drives()`, whose root is the list
 * of drives: `C:/Users/me` is `C:\Users\me`, and `''` is nothing on disk.
 */
export class FilePathResolver {
  private readonly root: string;

  /** Every drive is a root of its own; `''` lists them (see `drives`). */
  readonly allDrives: boolean;

  /**
   * @param reserved Names directly in the root that belong to the server,
   *   not to its users — the server's trash (PRD 005, §1). No path into one
   *   resolves, and no listing shows it.
   */
  constructor(
    root: string,
    private readonly reserved: readonly string[] = [],
    allDrives = false,
  ) {
    this.allDrives = allDrives;
    this.root = allDrives ? '' : resolve(root);
  }

  /**
   * A resolver over every drive of a Windows machine (PRD 003, §6). Paths
   * are Windows paths whatever the host, so it can be tested anywhere.
   */
  static drives(reserved: readonly string[] = []): FilePathResolver {
    return new FilePathResolver('', reserved, true);
  }

  get rootPath(): string {
    return this.root;
  }

  /**
   * Whether a root-relative path is a root nothing may rename, move or
   * trash: the root itself, or — over every drive — a drive.
   */
  isRoot(relative: string): boolean {
    return relative === '' || (this.allDrives && DRIVE_SEGMENT.test(relative));
  }

  /** Lexical resolution: rejects traversal out of the root. */
  resolve(requested: string | undefined): ResolvedPath {
    const raw = (requested ?? '').trim();
    if (raw.includes('\0')) {
      throw HttpError.badRequest('Path must not contain null bytes');
    }

    // A leading separator is interpreted relative to the root, never the host FS.
    const cleaned = raw.replace(/^[/\\]+/, '');
    if (this.allDrives) {
      return this.resolveOnDrive(cleaned);
    }
    const absolute = resolve(this.root, cleaned);
    this.assertInsideRoot(absolute);

    const relative = FilePathResolver.toPosix(relativePath(this.root, absolute));
    if (this.isReserved(relative)) {
      throw HttpError.forbidden('That folder belongs to the server');
    }
    return new ResolvedPath(absolute, relative);
  }

  /** The names directly in the root that belong to the server, which no listing shows. */
  get reservedNames(): readonly string[] {
    return this.reserved;
  }

  /** Whether a root-relative path is, or is inside, one of the reserved names. */
  isReserved(relative: string): boolean {
    const first = relative.split('/', 1)[0] as string;
    return this.reserved.includes(first);
  }

  /**
   * Lexical resolution plus a `realpath` check, so symlinks pointing outside
   * the root are rejected as well.
   *
   * On a file system that ignores case — Windows, a Samba share — a path
   * typed in another case than the disk's (`s:\tronog` for `S:\Tronog`)
   * finds the entry, but every path made from it would differ from the ones
   * listings report. So when the real path differs from the one asked for in
   * case alone, the real one is what comes back (PRD 004, §4.1). A link is
   * never swapped for where it leads: that differs by more than case.
   */
  async resolveReal(requested: string | undefined): Promise<ResolvedPath> {
    const candidate = this.resolve(requested);
    if (candidate.absolute === '') {
      return candidate; // The list of drives: nothing to follow.
    }
    let real: string;
    try {
      real = await realpath(candidate.absolute);
    } catch (error) {
      if (FilePathResolver.isErrnoException(error) && error.code === 'ENOENT') {
        return candidate;
      }
      throw error;
    }
    const relative = this.toRootRelative(real);
    if (relative === null && this.allDrives) {
      // Over every drive nothing escapes: a mapped network drive's real path
      // is its share (`\\server\share`), a mounted volume's a `\\?\Volume{…}`
      // one — no drive letter, but still this computer's files. Its case is
      // still the disk's: the path as asked, spelt as the share spells it.
      const corrected = FilePathResolver.caseFromShare(candidate.absolute, real);
      return corrected === null ? candidate : new ResolvedPath(corrected, this.toRootRelative(corrected) as string);
    }
    if (relative === null) {
      throw HttpError.forbidden('Path escapes the configured files root');
    }
    // A link elsewhere in the root must not be a way into a reserved folder either.
    if (this.isReserved(relative)) {
      throw HttpError.forbidden('That folder belongs to the server');
    }
    if (real !== candidate.absolute && real.toLowerCase() === candidate.absolute.toLowerCase()) {
      return new ResolvedPath(real, relative);
    }
    return candidate;
  }

  /**
   * `S:\tronog\sub` spelt as its real path on a share spells it —
   * `\\server\share\Tronog\Sub` makes it `S:\Tronog\Sub` (PRD 004, §4.1): the
   * drive kept, its path's last segments taken from the share's when they are
   * the same names but for case. `null` when they are not — a link on the way,
   * say — or there is nothing past the drive.
   */
  static caseFromShare(asked: string, real: string): string | null {
    const [drive, ...rest] = asked.split(/[\\/]+/).filter((segment) => segment !== '');
    const segments = real.split(/[\\/]+/).filter((segment) => segment !== '');
    if (drive === undefined || rest.length === 0 || segments.length < rest.length) {
      return null;
    }
    const tail = segments.slice(segments.length - rest.length);
    if (!tail.every((segment, index) => segment.toLowerCase() === (rest[index] as string).toLowerCase())) {
      return null;
    }
    const corrected = `${drive}\\${tail.join('\\')}`;
    return corrected === asked ? null : corrected;
  }

  /**
   * Root-relative POSIX form of an absolute host path, or `null` when that
   * path lies outside the root. Used for reporting symlink targets without
   * leaking host paths, and for places the system names (PRD 003, §6).
   */
  toRootRelative(absolute: string): string | null {
    if (this.allDrives) {
      const match = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(win32.resolve(absolute));
      if (match === null) {
        return null; // A UNC share, or not a Windows path at all.
      }
      const rest = FilePathResolver.toPosix((match[2] ?? '').replace(/[\\/]+$/, ''), '\\');
      return rest === '' ? `${(match[1] as string).toUpperCase()}:` : `${(match[1] as string).toUpperCase()}:/${rest}`;
    }
    const normalised = resolve(absolute);
    if (!FilePathResolver.within(this.root, normalised, sep)) {
      return null;
    }
    return FilePathResolver.toPosix(relativePath(this.root, normalised));
  }

  /** `C:/Users/me` → `C:\Users\me`; the first segment must name a drive. */
  private resolveOnDrive(cleaned: string): ResolvedPath {
    if (cleaned === '') {
      return new ResolvedPath('', '');
    }
    const [first, ...rest] = cleaned.split(/[/\\]+/);
    if (first === undefined || !DRIVE_SEGMENT.test(first)) {
      throw HttpError.notFound(`No such drive: ${first ?? cleaned}`);
    }
    // `D:` further in would be *drive-relative* — resolved against a working
    // directory — and `name:stream` an NTFS stream; neither is a file name.
    if (rest.some((segment) => segment.includes(':'))) {
      throw HttpError.badRequest('Path must not contain ":" after the drive');
    }
    const drive = `${first.toUpperCase()}\\`;
    const absolute = win32.resolve(drive, ...rest);
    if (!FilePathResolver.within(drive.slice(0, -1), absolute, '\\') && absolute !== drive) {
      throw HttpError.forbidden('Path escapes the configured files root');
    }
    const relative = this.toRootRelative(absolute) as string;
    if (this.isReserved(relative)) {
      throw HttpError.forbidden('That folder belongs to the server');
    }
    return new ResolvedPath(absolute, relative);
  }

  private assertInsideRoot(absolute: string): void {
    if (!isAbsolute(absolute) || !FilePathResolver.within(this.root, absolute, sep)) {
      throw HttpError.forbidden('Path escapes the configured files root');
    }
  }

  /**
   * Whether `absolute` is `root` or beneath it. A root that already ends in
   * a separator — `/`, `C:\` — is not given a second one, or nothing would
   * ever be inside the whole file system.
   */
  private static within(root: string, absolute: string, separator: string): boolean {
    const prefix = root.endsWith(separator) ? root : root + separator;
    return absolute === root || absolute.startsWith(prefix);
  }

  private static toPosix(value: string, separator: string = sep): string {
    return value.split(separator).join('/');
  }

  static isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
  }
}
