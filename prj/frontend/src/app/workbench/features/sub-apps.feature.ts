import { UiSubAppsFeature } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * Which sub-application fills the window (PRD 001, §1.1): the file manager,
 * Search or Disk Usage — the library's `UiSubAppsFeature`, with the file
 * manager as the main one. Disk Usage starts on the file manager's folder when
 * it has nothing open (PRD 013).
 */
export class SubAppsFeature extends UiSubAppsFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  /** The file manager is the one shown: its panels are there to act on. */
  readonly fileManager = this.mainShown;

  protected override onShown(id: string): void {
    super.onShown(id);
    if (id === 'disk-usage') {
      this.parent.diskUsageFt.shown();
    }
  }
}
