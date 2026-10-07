import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { UiSubApp } from '../ui-workbench.config';
import type { UiWorkbenchService } from '../ui-workbench.service';

/**
 * Which sub-application fills the window (PRD 001, §1.1). The title bar, the
 * activity bar and the status bar are everyone's; the sidebars, the panels
 * and the bottom panel are the main one's, and each other fills the centre.
 *
 * A sub-application is drawn the first time it is shown and kept, hidden,
 * while another one is — so coming back to the main one finds its panels as
 * they were left, scrolled and focused, rather than built anew.
 */
export class UiSubAppsFeature {
  readonly apps: readonly UiSubApp[];

  /** The one with the panels and the sidebars: the first, unless another is `main`. */
  readonly main: string;

  private readonly shown: WritableSignal<string>;

  /** Every sub-application shown so far — drawn, if only to be kept hidden. */
  private readonly opened: WritableSignal<ReadonlySet<string>>;

  readonly active: Signal<string>;

  constructor(protected readonly parent: UiWorkbenchService) {
    this.apps = parent.config.subApps;
    this.main = (this.apps.find((app) => app.main) ?? this.apps[0])?.id ?? '';
    this.shown = signal(this.main);
    this.opened = signal(new Set([this.main]));
    this.active = this.shown.asReadonly();
  }

  /** The main one is shown: its panels are there to act on. */
  readonly mainShown = computed(() => this.shown() === this.main);

  isActive(id: string): boolean {
    return this.shown() === id;
  }

  /** Whether `id` is drawn: shown now, or once before. */
  isOpened(id: string): boolean {
    return this.opened().has(id);
  }

  /** Brings `id` forward; back to the main one, the keyboard goes into the active panel (PRD 002, §3.1). */
  show(id: string): void {
    if (this.shown() === id) {
      return;
    }
    this.shown.set(id);
    if (!this.opened().has(id)) {
      this.opened.update((opened) => new Set([...opened, id]));
    }
    this.onShown(id);
  }

  /** What follows from `id` being shown; an application adds to it. */
  protected onShown(id: string): void {
    if (id === this.main) {
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }
}
