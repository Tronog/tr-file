import { signal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/**
 * The Disk Usage sub-application's state (PRD 001, §1.1): what takes up the
 * space under a folder. Opened on one by pressing its *Size* or *On disk* in
 * the details sidebar (§9.3.2). Not built yet — `open` is the one way in, so
 * the sidebar already reaches it, and the sub-application says it is to come.
 */
export class DiskUsageFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** The folder it was opened on, or `null` when opened from the activity bar alone. */
  readonly folder = signal<string | null>(null);

  open(path: string): void {
    this.folder.set(path);
    this.parent.subAppsFt.show('disk-usage');
  }
}
