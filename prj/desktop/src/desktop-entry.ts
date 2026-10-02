import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The app's id on a Linux desktop: the `desktopName` in `package.json`, less
 * `.desktop` — what Electron puts in `CHROME_DESKTOP`, and so the Wayland
 * `app_id` of the window and the id it registers with the portals under.
 */
export const DESKTOP_ID = 'tr-file';

/** What starts this copy of the app again. */
export interface DesktopLaunch {
  /** The program: the AppImage, or Electron itself in development. */
  readonly exec: string;
  /** Its arguments: the app folder for a bare Electron, none for an AppImage. */
  readonly args: readonly string[];
}

/**
 * How this copy is started: `APPIMAGE` names the file a running AppImage was
 * started from (its `execPath` is inside a mount that goes away with it); a
 * packaged binary is started as it is; a bare Electron needs the app folder.
 */
export function desktopLaunch(env: NodeJS.ProcessEnv, execPath: string, appPath: string, packaged: boolean): DesktopLaunch {
  if (env.APPIMAGE) {
    return { exec: env.APPIMAGE, args: [] };
  }
  return packaged ? { exec: execPath, args: [] } : { exec: execPath, args: [appPath] };
}

/** One `Exec` argument, quoted as the Desktop Entry spec asks. */
function quoteArg(arg: string): string {
  if (!/[\s"'\\`$;&|<>()*?#~=%[\]{}]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, '%%')}"`;
}

/** The `.desktop` file's text for this copy of the app. */
export function desktopEntry(launch: DesktopLaunch): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=tr-file',
    'Comment=File manager',
    `Exec=${[launch.exec, ...launch.args].map(quoteArg).join(' ')} %U`,
    `Icon=${DESKTOP_ID}`,
    'Terminal=false',
    'Categories=Utility;FileManager;',
    `StartupWMClass=${DESKTOP_ID}`,
    '',
  ].join('\n');
}

/**
 * Makes sure `<applications>/tr-file.desktop` describes this copy (PRD 001,
 * §8.5). A Wayland session gives out global shortcuts only through the
 * GlobalShortcuts portal, and xdg-desktop-portal refuses to register a host
 * app whose id names no installed desktop file (`App info not found`) — so
 * without it `Ctrl`+`` ` `` is never bound. An AppImage installs none, nor
 * does `electron .`; this writes one, and rewrites it only when the copy
 * started from has moved. Returns whether it wrote; a failure is the
 * caller's to log, never fatal.
 */
export function ensureDesktopEntry(applicationsDir: string, launch: DesktopLaunch): boolean {
  return writeIfChanged(join(applicationsDir, `${DESKTOP_ID}.desktop`), Buffer.from(desktopEntry(launch)));
}

/** The icon's size: `build/icon.png` is 512 pixels square. */
const ICON_SIZE = 512;

/**
 * Where this copy's icon is: shipped beside the frontend in a packaged app
 * (`extraResources` in `electron-builder.yml`), in `build/` in development.
 */
export function desktopIconSource(resourcesPath: string, appPath: string, packaged: boolean): string {
  return packaged ? join(resourcesPath, 'icon.png') : join(appPath, 'build', 'icon.png');
}

/**
 * Installs the icon the desktop entry names (`Icon=tr-file`) into the user's
 * hicolor theme, `<dataHome>/icons/hicolor/512x512/apps/tr-file.png`, and
 * again only when it has changed. Returns whether it wrote.
 */
export function ensureDesktopIcon(dataHome: string, source: string): boolean {
  const file = join(dataHome, 'icons', 'hicolor', `${ICON_SIZE}x${ICON_SIZE}`, 'apps', `${DESKTOP_ID}.png`);
  return writeIfChanged(file, readFileSync(source));
}

/** Writes `content` to `file` unless it holds that already — through a temporary file and a rename. */
function writeIfChanged(file: string, content: Buffer): boolean {
  let current: Buffer | null = null;
  try {
    current = readFileSync(file);
  } catch {
    // None yet.
  }
  if (current !== null && current.equals(content)) {
    return false;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, file);
  return true;
}
