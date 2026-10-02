import { Component, inject } from '@angular/core';
import { UiEmptyState } from '@tr-file/ui';
import { shownPath } from '../../../file-system/fs-path';
import { WorkbenchService } from '../../workbench.service';

/**
 * The Disk Usage sub-application (PRD 001, §1.1) — to be built: what takes up
 * the space under a folder. Opened on one from its Size in Details (§9.3.2,
 * `DiskUsageFeature.open`); until it is built it names that folder and no more.
 */
@Component({
  selector: 'app-disk-usage-app',
  imports: [UiEmptyState],
  template: `
    <ui-empty-state
      [state]="{
        icon: 'database',
        title: 'Disk Usage is not available yet',
        hint: hint(),
      }"
    />
  `,
  styleUrl: '../sub-app-placeholder.scss',
  host: {
    role: 'region',
    'aria-label': 'Disk Usage',
    '[class.is-inactive]': '!workbench.subAppsFt.isActive("disk-usage")',
  },
})
export class DiskUsageApp {
  protected readonly workbench = inject(WorkbenchService);

  protected hint(): string {
    const folder = this.workbench.diskUsageFt.folder();
    return folder === null
      ? 'It will show what takes up the space in a folder.'
      : `It will show what takes up the space in ${folder === '' ? '/' : shownPath(folder)}.`;
  }
}
