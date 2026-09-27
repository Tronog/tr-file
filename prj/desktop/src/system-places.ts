import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';

import type { PlaceKind, PlacesProvider, SystemPlace } from '@tr-file/backend/files';

/** The user's folders, by the name Electron's `app.getPath` knows them under. */
const USER_FOLDERS: readonly { readonly name: string; readonly label: string; readonly kind: PlaceKind }[] = [
  { name: 'desktop', label: 'Desktop', kind: 'desktop' },
  { name: 'documents', label: 'Documents', kind: 'documents' },
  { name: 'downloads', label: 'Downloads', kind: 'downloads' },
  { name: 'pictures', label: 'Pictures', kind: 'pictures' },
  { name: 'music', label: 'Music', kind: 'music' },
  { name: 'videos', label: 'Videos', kind: 'videos' },
];

/** File systems that live on another machine, whatever they are mounted as. */
const NETWORK_TYPES: ReadonlySet<string> = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smb3',
  'smbfs',
  'sshfs',
  'fuse.sshfs',
  'davfs',
  'fuse.davfs2',
  'fuse.rclone',
  'afpfs',
  '9p',
]);

/** Where Linux desktops mount what is plugged in, and where people mount by hand. */
const REMOVABLE_PARENTS = ['/media/', '/run/media/'];
const MOUNT_PARENTS = ['/mnt/'];

/** What `SystemPlaces` needs from its surroundings; `main.ts` passes Electron's. */
export interface SystemPlacesOptions {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  /** `app.getPath(name)`, or `null` when the system has no such folder. */
  readonly userFolder: (name: string) => string | null;
  /** `/proc/self/mounts`; injected for tests. */
  readonly mountTable?: () => Promise<string>;
  /** Whether a path is a folder that answers; injected for tests. */
  readonly isFolder?: (path: string) => Promise<boolean>;
  /** Names in `/Volumes`; injected for tests. */
  readonly volumes?: () => Promise<readonly string[]>;
  /** Where a path really is — a macOS volume that is the start-up disk links to `/`. */
  readonly realpath?: (path: string) => Promise<string>;
}

/**
 * What a file manager lists in its sidebar, on this machine (PRD 003, §6):
 * the home folder and the user's own folders, then every drive and mount —
 * USB sticks, network shares, disks mounted by hand.
 *
 * Looked up on each request, so what was plugged in since is there. Nothing
 * here imports `electron`: the user's folders come from `app.getPath` through
 * `userFolder`, and everything else is read from the system as a file manager
 * would — the mount table on Linux, `/Volumes` on macOS, the drive letters on
 * Windows. Anything that cannot be read is left out, never an error: a
 * sidebar with fewer places beats no sidebar.
 */
export class SystemPlaces implements PlacesProvider {
  readonly rootLabel: string;

  private readonly isFolder: (path: string) => Promise<boolean>;

  constructor(private readonly options: SystemPlacesOptions) {
    this.rootLabel = options.platform === 'win32' ? 'This PC' : 'File System';
    this.isFolder =
      options.isFolder ??
      (async (path) => {
        try {
          return (await stat(path)).isDirectory();
        } catch {
          return false;
        }
      });
  }

  home(): string {
    return this.options.home;
  }

  async places(): Promise<readonly SystemPlace[]> {
    return [...this.userPlaces(), ...(await this.devices())];
  }

  /** Home, then the user's folders — those that exist and are not home itself. */
  private userPlaces(): SystemPlace[] {
    const home = this.options.home;
    const places: SystemPlace[] = [{ id: 'home', label: 'Home', kind: 'home', absolute: home }];
    for (const folder of USER_FOLDERS) {
      let absolute: string | null;
      try {
        absolute = this.options.userFolder(folder.name);
      } catch {
        absolute = null; // Electron throws for a folder the system does not have.
      }
      // An unconfigured XDG folder is the home folder itself: nothing to list twice.
      if (absolute !== null && absolute !== '' && absolute !== home) {
        places.push({ id: folder.name, label: folder.label, kind: folder.kind, absolute });
      }
    }
    return places;
  }

  private async devices(): Promise<SystemPlace[]> {
    switch (this.options.platform) {
      case 'win32':
        return this.drives();
      case 'darwin':
        return this.volumes();
      default:
        return this.mounts();
    }
  }

  /** Every drive letter whose root answers. */
  private async drives(): Promise<SystemPlace[]> {
    const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
    const present = await Promise.all(letters.map(async (letter) => ((await this.isFolder(`${letter}:\\`)) ? letter : null)));
    return present
      .filter((letter): letter is string => letter !== null)
      .map((letter) => ({ id: `drive-${letter}`, label: `${letter}:`, kind: 'drive', absolute: `${letter}:\\` }));
  }

  /** `/Volumes`, but for the start-up disk, which is `/` again. */
  private async volumes(): Promise<SystemPlace[]> {
    const names = await (this.options.volumes ?? (() => readdir('/Volumes')))().catch(() => [] as readonly string[]);
    const resolveLink = this.options.realpath ?? realpath;
    const places: SystemPlace[] = [];
    for (const name of names) {
      const absolute = join('/Volumes', name);
      if ((await resolveLink(absolute).catch(() => absolute)) === '/' || !(await this.isFolder(absolute))) {
        continue;
      }
      places.push({ id: `volume-${name}`, label: name, kind: 'drive', absolute });
    }
    return places;
  }

  /**
   * The mount table: what is mounted under `/media` or `/run/media` (plugged
   * in), under `/mnt` (mounted by hand), and any network file system wherever
   * it is. The system's own mounts — `/proc`, `/boot`, snaps — are not places.
   */
  private async mounts(): Promise<SystemPlace[]> {
    const table = await (this.options.mountTable ?? (() => readFile('/proc/self/mounts', 'utf8')))().catch(() => '');
    const places: SystemPlace[] = [];
    for (const line of table.split('\n')) {
      const [, rawPoint, type] = line.split(' ');
      if (rawPoint === undefined || type === undefined) {
        continue;
      }
      const point = SystemPlaces.unescape(rawPoint);
      const network = NETWORK_TYPES.has(type);
      const kind: PlaceKind | null = network
        ? 'network'
        : REMOVABLE_PARENTS.some((parent) => point.startsWith(parent))
          ? 'removable'
          : MOUNT_PARENTS.some((parent) => point.startsWith(parent))
            ? 'drive'
            : null;
      if (kind === null || point === '/' || places.some((place) => place.absolute === point)) {
        continue;
      }
      places.push({ id: `mount-${point}`, label: basename(point) || point, kind, absolute: point });
    }
    return places.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /** The mount table writes a space as `\040`, a tab as `\011`, and so on. */
  private static unescape(field: string): string {
    return posix.normalize(field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8))));
  }
}
