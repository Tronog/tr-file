import { computed, signal } from '@angular/core';
import type { UiProperty } from '@tr-file/ui';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';
import { shownPath, type FsPathStyle } from '../../file-system/fs-path';

/** How long a copied path's value says `Copied` (PRD 001, §9.3.1). */
export const COPIED_BADGE_MS = 1500;

/** A path shown as a value somewhere, to copy when pressed: an entry of the root, or text naming none. */
export type CopyablePath = { readonly path: string } | { readonly text: string };

/** Which system the window runs on, as far as naming things after it goes. */
type Platform = 'windows' | 'mac' | 'other';

function platform(): Platform {
  const agent = globalThis.navigator?.userAgent ?? '';
  return /Windows/i.test(agent) ? 'windows' : /Mac OS X|Macintosh/i.test(agent) ? 'mac' : 'other';
}

/**
 * Handing entries to the rest of the user's computer (PRD 003, §5): opening
 * one with the application the system has for it, and showing one in the
 * system's own file manager.
 *
 * On the desktop the main process does both — for a file on a remote server
 * it opens a copy, and it asks before it runs a program. In a browser, *open*
 * is a new tab on the file, which shows a PDF, a picture or a video and saves
 * the rest; there is no file manager to reveal anything in, so *reveal* is
 * offered only where it can work (`canReveal`). The names follow the system,
 * as VS Code's do: *Reveal in File Explorer* on Windows, *Reveal in Finder* on
 * macOS, *Open Containing Folder* elsewhere.
 */
export class SystemOpenFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** Whether *reveal* can work here: the desktop, on this computer's files. */
  readonly canReveal = computed(() => this.parent.fileSystem.systemFt.canReveal(this.parent.backend() === 'remote'));

  openLabel(): string {
    return this.parent.fileSystem.systemFt.opensInApps ? 'Open with Default App' : 'Open in New Browser Tab';
  }

  revealLabel(): string {
    switch (platform()) {
      case 'windows':
        return 'Reveal in File Explorer';
      case 'mac':
        return 'Reveal in Finder';
      default:
        return 'Open Containing Folder';
    }
  }

  /**
   * *Copy Path* (PRD 003, §5): the entries' paths, one per line, on the
   * clipboard — real host paths on the desktop, or with `unix` those paths
   * the UNIX way (`/C/Users/me`, PRD 004, §1.3.2). A clipboard that refuses
   * is said, never swallowed.
   */
  async copyPaths(paths: readonly string[], style: FsPathStyle = 'native'): Promise<boolean> {
    if (paths.length === 0) {
      return false;
    }
    try {
      await this.parent.fileSystem.systemFt.copyPaths(paths, style);
      return true;
    } catch (error) {
      await this.parent.modal.message({
        severity: 'error',
        message: paths.length === 1 ? 'Could not copy the path.' : 'Could not copy the paths.',
        detail: FsError.from(error).message,
      });
      return false;
    }
  }

  /** The value copied last, by the key its list gave it — `Copied` beside it for a moment. */
  private readonly copiedKey = signal<string | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * A path pressed in the details sidebar (PRD 001, §9.3.1): copied — an
   * entry of the root as its full host path, as *Copy Path* does, text naming
   * none (a link's target) as it is; the UNIX way with `Shift`. `key` names
   * the value, so it can say `Copied` (`copyable`).
   */
  async copyPathValue(key: string, value: CopyablePath, shift: boolean): Promise<void> {
    const style: FsPathStyle = shift ? 'unix' : 'native';
    let copied: boolean;
    if ('path' in value) {
      copied = await this.copyPaths([value.path], style);
    } else {
      try {
        await this.parent.fileSystem.systemFt.copyText(value.text, style);
        copied = true;
      } catch (error) {
        await this.parent.modal.message({ severity: 'error', message: 'Could not copy the path.', detail: FsError.from(error).message });
        copied = false;
      }
    }
    if (copied) {
      clearTimeout(this.copiedTimer);
      this.copiedKey.set(key);
      this.copiedTimer = setTimeout(() => this.copiedKey.set(null), COPIED_BADGE_MS);
    }
  }

  /** `property` as a path to copy, under `key`: a button that says what a press does, and `Copied` after one. */
  copyable(property: UiProperty, key: string): UiProperty {
    return {
      ...property,
      action: key,
      copy: true,
      actionLabel: 'Copy the path — Shift+click copies it the UNIX way',
      ...(this.copiedKey() === key ? { badge: 'Copied' } : {}),
    };
  }

  /** Opens `path` outside the app; a refusal is said, a declined program is not. */
  async open(path: string): Promise<void> {
    const name = path.slice(path.lastIndexOf('/') + 1) || this.parent.workspaceName();
    try {
      await this.parent.fileSystem.systemFt.open(path, name);
    } catch (error) {
      await this.parent.modal.message({
        severity: 'error',
        message: `Could not open '${name}'.`,
        detail: FsError.from(error).message,
      });
    }
  }

  async reveal(path: string): Promise<void> {
    try {
      await this.parent.fileSystem.systemFt.reveal(path);
    } catch (error) {
      await this.parent.modal.message({
        severity: 'error',
        message: `Could not show '${shownPath(path)}' in its folder.`,
        detail: FsError.from(error).message,
      });
    }
  }
}
