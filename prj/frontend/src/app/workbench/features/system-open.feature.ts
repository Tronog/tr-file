import { computed } from '@angular/core';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

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
   * clipboard — real host paths on the desktop. A clipboard that refuses is
   * said, never swallowed.
   */
  async copyPaths(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    try {
      await this.parent.fileSystem.systemFt.copyPaths(paths);
    } catch (error) {
      await this.parent.modal.message({
        severity: 'error',
        message: paths.length === 1 ? 'Could not copy the path.' : 'Could not copy the paths.',
        detail: FsError.from(error).message,
      });
    }
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
        message: `Could not show '/${path}' in its folder.`,
        detail: FsError.from(error).message,
      });
    }
  }
}
