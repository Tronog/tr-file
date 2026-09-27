import { computed } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/** The regions `Ctrl`+`Tab` moves between; a panel group is `group:<id>`. */
export type FocusRegionId = 'explorer' | 'bottom' | 'details' | `group:${string}`;

/**
 * `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab`: from one part of the workbench to the
 * next (PRD 002, §2.6) — the explorer, each panel in layout order, the bottom
 * panel while it is open, the details sidebar, and round again.
 *
 * This decides the ring and what a step means; the component does the DOM
 * half — which region focus is in now, and what to focus in the next one —
 * since only it can see elements. A panel is entered the way choosing its
 * tab enters it (`PanelFocusFeature`), so it becomes the active panel and the
 * keyboard lands on its cursor row; the sidebars get back the element that
 * last had focus in them, or their first stop.
 *
 * In a browser the chords belong to the browser — they switch tabs — and the
 * page never sees them; the desktop app gets them.
 */
export class FocusCycleFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** Every stop, in order. */
  readonly ring = computed<readonly FocusRegionId[]>(() => [
    'explorer',
    ...this.parent.panelLayoutFt.groupIds().map((id): FocusRegionId => `group:${id}`),
    ...(this.parent.bottomPanelFt.collapsed() ? [] : (['bottom'] as const)),
    'details',
  ]);

  /** `Ctrl`+`Tab` or `Ctrl`+`Shift`+`Tab`: `1` forward, `-1` back, `0` for any other key. */
  directionOf(event: KeyboardEvent): -1 | 0 | 1 {
    if (event.key !== 'Tab' || !event.ctrlKey || event.altKey || event.metaKey) {
      return 0;
    }
    // Not while a window or the palette has the keyboard: they keep it.
    if (this.parent.modal.isOpen() || this.parent.commandPaletteFt.isOpen()) {
      return 0;
    }
    return event.shiftKey ? -1 : 1;
  }

  /**
   * The stops to try from `current`, nearest first, all the way round. A
   * stop with nothing to focus (a tree still loading) is passed over by the
   * caller, which is why this is a list and not one answer. From outside
   * every region — the title bar, nowhere — the first stop is the active panel.
   */
  sequence(current: FocusRegionId | null, direction: -1 | 1): readonly FocusRegionId[] {
    const ring = this.ring();
    const at = current === null ? -1 : ring.indexOf(current);
    if (at === -1) {
      const active: FocusRegionId = `group:${this.parent.activeGroupId()}`;
      return [active, ...ring.filter((region) => region !== active)];
    }
    return Array.from({ length: ring.length - 1 }, (_, step) => {
      const index = (at + direction * (step + 1) + ring.length * ring.length) % ring.length;
      return ring[index] as FocusRegionId;
    });
  }

  /** Enters a panel as choosing its tab does; `false` for a region the component must focus. */
  enter(region: FocusRegionId): boolean {
    if (!region.startsWith('group:')) {
      return false;
    }
    this.parent.panelFocusFt.focusBody(region.slice('group:'.length));
    return true;
  }
}
