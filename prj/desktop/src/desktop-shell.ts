import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * What the operating system's shell does for the window (PRD 003, §5): open
 * an entry with its default app, show it in the system file manager, and ask
 * before running a program. Electron's `shell` and `dialog` in `main.ts`;
 * stubs in tests — so `BridgeSessions`, which uses it, imports no `electron`.
 */
export interface DesktopShell {
  /** Electron's `shell.openPath`: resolves with `''` on success, else why not. */
  openPath(path: string): Promise<string>;
  /** Electron's `shell.showItemInFolder`. */
  showItemInFolder(path: string): void;
  /**
   * Asks the user, in a native dialog, whether to run the program `name`.
   * Resolves `true` only for an explicit Run.
   */
  confirmRun(name: string): Promise<boolean>;
}

/**
 * Where copies of remote files are put to be opened with an app on this
 * computer: `<tmp>/tr-file-open/<uuid>/<name>`. Removed when the app quits.
 */
export function openTempRoot(base: string = tmpdir()): string {
  return join(base, 'tr-file-open');
}

/**
 * Extensions that run something when opened, whatever the platform the file
 * came from — a Windows program on a Linux share is still a program to the
 * Windows machine that opens it, and a script handler may be installed
 * anywhere.
 */
const PROGRAM_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'ps1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'scr', 'lnk', 'hta', 'cpl', 'pif', 'reg', 'jar',
]);

/** Launchers and scripts a POSIX desktop runs when they are opened. */
const POSIX_PROGRAM_EXTENSIONS: ReadonlySet<string> = new Set(['desktop', 'sh', 'run', 'appimage', 'command', 'app']);

/**
 * Whether opening `name` would run it rather than show it: a program's
 * extension, or — on a POSIX system — a regular file with an execute bit.
 * Decided in the main process, where a compromised page cannot skip it.
 */
export function looksLikeProgram(name: string, executable: boolean, platform: NodeJS.Platform = process.platform): boolean {
  const extension = extname(name).slice(1).toLowerCase();
  if (PROGRAM_EXTENSIONS.has(extension)) {
    return true;
  }
  if (platform === 'win32') {
    return false;
  }
  return executable || POSIX_PROGRAM_EXTENSIONS.has(extension);
}

/**
 * A name a remote server gave, made safe to create in a temp folder here: the
 * last segment only, and nothing a file system on this computer would refuse
 * or read as a path.
 */
export function localFileName(path: string): string {
  const last = path.split('/').at(-1) ?? '';
  const safe = last.replace(/[<>:"|?*\\/\x00-\x1f]/g, '_').trim();
  return safe === '' || safe === '.' || safe === '..' ? 'file' : safe;
}
