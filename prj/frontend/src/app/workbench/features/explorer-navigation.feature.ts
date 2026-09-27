import type { WorkbenchService } from '../workbench.service';
import { isFolder } from '../../file-system/fs-entry-kind';

/**
 * The link between the explorer and the panels.
 *
 * Clicking a folder in the sidebar shows it in the active panel — the gesture
 * that makes the two halves of the workbench one thing rather than two trees
 * side by side. It lives in its own class because it belongs to neither: the
 * explorer should not know what a panel group is, and a group should not know
 * the sidebar exists.
 *
 * Expanding and collapsing stays with the twisty (and the arrow keys); a row
 * click only ever opens, so clicking an already-open folder shows it again
 * rather than folding it away.
 */
export class ExplorerNavigationFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /**
   * Handles a click on a tree row: always select it, and for a directory also
   * reveal its children and point the active panel at it.
   */
  open(path: string): void {
    this.parent.select(path);
    this.parent.explorerFt.select(path);

    if (!this.isDirectory(path)) {
      return;
    }

    this.parent.explorerFt.expand(path);
    this.parent.fileBrowserFt.openFolder(this.parent.activeGroupId(), path, this.labelFor(path));
  }

  /**
   * The root is a directory the listing never describes (it has no entry of
   * its own), so it is recognised by its empty path. A link to a folder counts.
   */
  private isDirectory(path: string): boolean {
    const entry = this.parent.fsDataFt.entryAt(path);
    return path === '' || (entry !== undefined && isFolder(entry));
  }

  private labelFor(path: string): string {
    return path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path);
  }
}
