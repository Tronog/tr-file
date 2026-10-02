import { computed, signal } from '@angular/core';
import { DEFAULT_SUB_APP, SUB_APPS, type SubApp, type SubAppId } from '../sub-apps/sub-app.model';
import type { WorkbenchService } from '../workbench.service';

/**
 * Which sub-application fills the window (PRD 001, §1.1): the file manager,
 * Search or Disk Usage. The title bar, the activity bar and the status bar
 * are everyone's; the sidebars and the centre are the shown one's.
 *
 * A sub-application is drawn the first time it is shown and kept, hidden,
 * while another one is — so coming back to the file manager finds its
 * panels as they were left, scrolled and focused, rather than built anew.
 * What it shows lives in its features anyway; only the DOM is kept.
 */
export class SubAppsFeature {
  constructor(private readonly parent: WorkbenchService) {}

  readonly apps: readonly SubApp[] = SUB_APPS;

  private readonly shown = signal<SubAppId>(DEFAULT_SUB_APP);

  /** Every sub-application shown so far — drawn, if only to be kept hidden. */
  private readonly opened = signal<ReadonlySet<SubAppId>>(new Set([DEFAULT_SUB_APP]));

  readonly active = this.shown.asReadonly();

  /** The file manager is the one shown: its panels are there to act on. */
  readonly fileManager = computed(() => this.shown() === 'file-manager');

  isActive(id: SubAppId): boolean {
    return this.shown() === id;
  }

  /** Whether `id` is drawn: shown now, or once before. */
  isOpened(id: SubAppId): boolean {
    return this.opened().has(id);
  }

  /**
   * Brings `id` forward. Back to the file manager, the keyboard goes into the
   * active panel, as it does when the app starts (PRD 002, §3.1).
   */
  show(id: SubAppId): void {
    if (this.shown() === id) {
      return;
    }
    this.shown.set(id);
    if (!this.opened().has(id)) {
      this.opened.update((opened) => new Set([...opened, id]));
    }
    if (id === 'file-manager') {
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }
}
