import type { WorkbenchService } from '../workbench.service';
import { shownPath } from '../../file-system/fs-path';

/**
 * The `disk-usage` sub-application (PRD 001, §9.3.2): what takes up the space
 * under a folder. Opened by pressing a folder's *Size* or *On disk* in the
 * details sidebar. Not built yet — `open` is the one way in, so the sidebar
 * already reaches it, and for now it says so.
 */
export class DiskUsageFeature {
  constructor(private readonly parent: WorkbenchService) {}

  async open(path: string): Promise<void> {
    await this.parent.modal.message({
      message: 'Disk Usage is not available yet.',
      detail: `It will show what takes up the space in ${path === '' ? '/' : shownPath(path)}.`,
      severity: 'info',
    });
  }
}
