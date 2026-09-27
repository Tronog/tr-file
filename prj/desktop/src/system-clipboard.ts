import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Raw formats on the system clipboard — Electron's, adapted in
 * `electron-clipboard.ts`, so nothing here imports `electron`.
 */
export interface ClipboardLike {
  /** The bytes of one raw format, or `null` when the clipboard has none. */
  readFormat(format: string): Promise<Buffer | null>;
  /** Replaces the clipboard with these formats, all at once. */
  writeFormats(formats: Readonly<Record<string, string>>): Promise<void>;
}

/** Files on the system clipboard, and whether they were cut rather than copied. */
export interface ClipboardFiles {
  /** Absolute host paths. */
  readonly files: readonly string[];
  readonly cut: boolean;
}

/** GNOME's own format — Files, Nemo, Caja and Thunar paste it, and it says cut or copy. */
const GNOME_FILES = 'x-special/gnome-copied-files';
const URI_LIST = 'text/uri-list';
/** KDE says "cut" beside a `text/uri-list` with this. */
const KDE_CUT = 'application/x-kde-cutselection';
/** What Finder puts on the pasteboard: a property list of paths. */
const MAC_FILES = 'NSFilenamesPboardType';
/** What Explorer puts beside `CF_HDROP`: the first file's path, UTF-16. */
const WINDOWS_FILE = 'FileNameW';
const PLAIN_TEXT = 'text/plain';

/**
 * Files on the operating system's clipboard (PRD 003, §6): what was copied
 * in the system's file manager can be pasted here, and what is copied here
 * can be pasted there.
 *
 * Each system says "these are files" its own way, and Electron can only read
 * and write the raw formats, so this is where the formats are known:
 *
 * - **Linux**: `x-special/gnome-copied-files` (`copy` or `cut`, then file
 *   URLs) — GNOME Files, Nemo, Caja, Thunar — and `text/uri-list` with KDE's
 *   cut marker — Dolphin — are read, and both are written.
 * - **macOS**: Finder's `NSFilenamesPboardType` property list, both ways.
 *   Finder has no cut; a move there is Option-⌘-V.
 * - **Windows**: Explorer's `FileNameW` is read — Electron cannot reach the
 *   `CF_HDROP` list, so that is the first file of a selection. Nothing can be
 *   written that Explorer pastes as files, so copying here leaves the paths
 *   as text.
 *
 * Every system also gets the paths as plain text, for pasting into anything
 * else.
 *
 * Anything that cannot be read is no files, never an error.
 */
export class SystemClipboard {
  constructor(
    private readonly clipboard: ClipboardLike,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async readFiles(): Promise<ClipboardFiles> {
    try {
      switch (this.platform) {
        case 'darwin': {
          const plist = await this.text(MAC_FILES);
          return { files: plist === null ? [] : SystemClipboard.plistStrings(plist), cut: false };
        }
        case 'win32': {
          const raw = await this.clipboard.readFormat(WINDOWS_FILE);
          const first = raw === null ? '' : raw.toString('utf16le').replace(/\0+$/, '');
          return { files: first === '' ? [] : [first], cut: false };
        }
        default:
          return await this.readLinux();
      }
    } catch {
      return { files: [], cut: false };
    }
  }

  async writeFiles(files: readonly string[], cut: boolean): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const text = files.join(this.platform === 'win32' ? '\r\n' : '\n');
    switch (this.platform) {
      case 'darwin':
        await this.clipboard.writeFormats({ [MAC_FILES]: SystemClipboard.plist(files), [PLAIN_TEXT]: text });
        return;
      case 'win32':
        await this.clipboard.writeFormats({ [PLAIN_TEXT]: text });
        return;
      default: {
        const urls = files.map((file) => pathToFileURL(file).href);
        await this.clipboard.writeFormats({
          [GNOME_FILES]: `${cut ? 'cut' : 'copy'}\n${urls.join('\n')}`,
          [URI_LIST]: `${urls.join('\r\n')}\r\n`,
          ...(cut ? { [KDE_CUT]: '1' } : {}),
          [PLAIN_TEXT]: text,
        });
      }
    }
  }

  private async readLinux(): Promise<ClipboardFiles> {
    const gnome = await this.text(GNOME_FILES);
    if (gnome !== null) {
      const [action, ...urls] = gnome.split(/\r?\n/);
      return { files: SystemClipboard.paths(urls), cut: action?.trim() === 'cut' };
    }
    const list = await this.text(URI_LIST);
    if (list !== null) {
      const urls = list.split(/\r?\n/).filter((line) => !line.startsWith('#'));
      return { files: SystemClipboard.paths(urls), cut: (await this.text(KDE_CUT))?.trim() === '1' };
    }
    return { files: [], cut: false };
  }

  private async text(format: string): Promise<string | null> {
    const raw = await this.clipboard.readFormat(format);
    return raw === null ? null : raw.toString('utf8').replace(/\0+$/, '');
  }

  /** `file:` URLs as paths; anything else — an `http:` link, a blank line — is not a file. */
  private static paths(urls: readonly string[]): string[] {
    const paths: string[] = [];
    for (const url of urls) {
      const trimmed = url.trim();
      if (!trimmed.startsWith('file:')) {
        continue;
      }
      try {
        paths.push(fileURLToPath(trimmed));
      } catch {
        // A file URL for another host: not on this machine.
      }
    }
    return paths;
  }

  private static plistStrings(xml: string): string[] {
    return [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => SystemClipboard.unescapeXml(match[1] as string));
  }

  private static plist(files: readonly string[]): string {
    const strings = files.map((file) => `<string>${SystemClipboard.escapeXml(file)}</string>`).join('');
    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
      `<plist version="1.0"><array>${strings}</array></plist>`
    );
  }

  private static escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private static unescapeXml(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
}
