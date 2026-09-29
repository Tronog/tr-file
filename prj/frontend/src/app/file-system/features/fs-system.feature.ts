import type { FsClipboardFiles } from '../file-system.model';
import type { FileSystemService } from '../file-system.service';
import type { FsPathStyle } from '../fs-path';

/**
 * Handing entries to the user's own computer (PRD 003, §5): opening one with
 * its default application, and showing one in the system's file manager.
 *
 * On the desktop the main process does both — and asks before it runs a
 * program. In a browser *open* is a new tab on the file, and *reveal* does
 * not exist, which `canReveal` says so the commands can be offered honestly.
 */
export class FsSystemFeature {
  constructor(private readonly parent: FileSystemService) {}

  /**
   * Whether this window can show an entry in the system's file manager. Only
   * where there is a system shell at all, and only for this computer's files:
   * `remote` is the caller's to say, since the connection is not known here.
   */
  canReveal(remote: boolean): boolean {
    return this.parent.transport.systemShell && !remote;
  }

  /** Whether *open* reaches an application of the user's computer, rather than a browser tab. */
  get opensInApps(): boolean {
    return this.parent.transport.systemShell;
  }

  /** Resolves `false` when the user declined — a program they chose not to run. */
  open(path: string, name: string): Promise<boolean> {
    return this.parent.transport.openExternally(path, name);
  }

  reveal(path: string): Promise<void> {
    return this.parent.transport.reveal(path);
  }

  /* -- files shared with the system (PRD 003, §6) ------------------------- */

  /**
   * Whether this window shares files with the system — its clipboard, drags
   * to and from other apps. The desktop, for its own computer's files only:
   * `remote` is the caller's to say, as for `canReveal`.
   */
  sharesFiles(remote: boolean): boolean {
    return this.parent.transport.systemFiles && !remote;
  }

  readClipboard(): Promise<FsClipboardFiles> {
    return this.parent.transport.readClipboard();
  }

  writeClipboard(paths: readonly string[], cut: boolean): Promise<void> {
    return this.parent.transport.writeClipboard(paths, cut);
  }

  /** *Copy Path*; answers with the text put on the clipboard. */
  copyPaths(paths: readonly string[], style: FsPathStyle = 'native'): Promise<string> {
    return this.parent.transport.copyPaths(paths, style);
  }

  startDrag(paths: readonly string[]): boolean {
    return this.parent.transport.startDrag(paths);
  }

  localPaths(files: readonly File[]): Promise<readonly (string | null)[]> {
    return this.parent.transport.localPaths(files);
  }
}
