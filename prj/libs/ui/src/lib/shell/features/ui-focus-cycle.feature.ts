import { computed, inject } from '@angular/core';
import { UiKeymap } from '../../keyboard/keymap';
import type { UiWorkbenchService } from '../ui-workbench.service';
import { UI_FOCUS_COMMANDS } from './ui-keybindings.feature';

/** `Tab` / `Shift`+`Tab` between panels, as the keymap binds them (`when: 'panel'`). */
const PANEL_COMMANDS = ['workbench.nextPanel', 'workbench.previousPanel'] as const;

/** The regions `Ctrl`+`Tab` moves between: a sidebar by its id, `bottom`, and a panel group as `group:<id>`. */
export type UiFocusRegionId = string;

/**
 * `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab`: from one part of the workbench to the
 * next (PRD 002, §2.6) — the sidebars on the left, each panel in layout order,
 * the bottom panel while it is open, the sidebars on the right, and round again.
 *
 * This decides the ring and what a step means; the shell does the DOM
 * half — which region focus is in now, and what to focus in the next one —
 * since only it can see elements. A panel is entered the way choosing its
 * tab enters it (`PanelFocusFeature`), so it becomes the active panel and the
 * keyboard lands on its cursor row; the sidebars get back the element that
 * last had focus in them, or their first stop.
 *
 * In a browser the chords belong to the browser — they switch tabs — and the
 * page never sees them; the desktop app gets them.
 *
 * Plain `Tab` / `Shift`+`Tab` in a panel's body walk the panels only (§2.6),
 * which works in a browser too; see `panelDirectionOf`.
 */
export class UiFocusCycleFeature {
  private readonly keymap = inject(UiKeymap);

  constructor(protected readonly parent: UiWorkbenchService) {}

  /** Every stop, in order. */
  readonly ring = computed<readonly UiFocusRegionId[]>(() => {
    // The regions are the main sub-application's (PRD 001, §1.1); another has none.
    if (!this.parent.subAppsFt.mainShown()) {
      return [];
    }
    // Left to right as the window shows them, wherever the settings put the
    // sidebars (PRD 010, §3): on one side together, the first is outermost.
    // A hidden sidebar is not in it.
    const preferences = this.parent.preferencesFt;
    const sidebars = this.parent.config.sidebars.filter((sidebar) => this.parent.chromeFt.isShown(sidebar.id));
    const at = (side: 'left' | 'right'): readonly string[] => sidebars.filter((sidebar) => preferences.sideOf(sidebar.id) === side).map((sidebar) => sidebar.id);
    return [
      ...at('left'),
      ...this.parent.panelLayoutFt.groupIds().map((id) => `group:${id}`),
      ...(this.parent.bottomPanelFt.collapsed() ? [] : ['bottom']),
      ...[...at('right')].reverse(),
    ];
  });

  /**
   * `Ctrl`+`Tab` or `Ctrl`+`Shift`+`Tab` — whatever the keymap binds to
   * *Focus Next Part* / *Focus Previous Part* (PRD 010, §2): `1` forward,
   * `-1` back, `0` for any other key.
   */
  directionOf(event: KeyboardEvent): -1 | 0 | 1 {
    const command = this.keymap.commandFor(event, 'window', UI_FOCUS_COMMANDS);
    // Not while a window or the palette has the keyboard: they keep it.
    if (command === null || this.parent.modal.isOpen() || this.parent.commandPaletteFt.isOpen()) {
      return 0;
    }
    return command === 'workbench.focusPreviousPart' ? -1 : 1;
  }

  /**
   * The stops to try from `current`, nearest first, all the way round. A
   * stop with nothing to focus (a tree still loading) is passed over by the
   * caller, which is why this is a list and not one answer. From outside
   * every region — the title bar, nowhere — the first stop is the active panel.
   */
  sequence(current: UiFocusRegionId | null, direction: -1 | 1): readonly UiFocusRegionId[] {
    const ring = this.ring();
    if (ring.length === 0) {
      return [];
    }
    const at = current === null ? -1 : ring.indexOf(current);
    if (at === -1) {
      const active: UiFocusRegionId = `group:${this.parent.activeGroupId()}`;
      return [active, ...ring.filter((region) => region !== active)];
    }
    return Array.from({ length: ring.length - 1 }, (_, step) => {
      const index = (at + direction * (step + 1) + ring.length * ring.length) % ring.length;
      return ring[index] as UiFocusRegionId;
    });
  }

  /**
   * `Tab` or `Shift`+`Tab` in a panel's body (PRD 002, §2.6): `1` / `-1` to
   * the next or previous panel, as Midnight Commander's `Tab` changes panel —
   * `0` when the key is not that, or there is no other panel to go to, and
   * `Tab` keeps its usual meaning.
   *
   * Only in the body — its rows, its tiles, the document — and never in a
   * text field: the chrome above it (path bar, filter box, toolbar) is still
   * walked with `Tab`, and the sidebars leave their `Tab` to the browser.
   * `Ctrl`+`Tab` is the way out of the panels.
   */
  panelDirectionOf(event: KeyboardEvent, inBody: boolean): -1 | 0 | 1 {
    const command = inBody ? this.keymap.commandFor(event, 'panel', PANEL_COMMANDS) : null;
    if (command === null || this.parent.modal.isOpen() || this.parent.commandPaletteFt.isOpen() || this.panels().length < 2) {
      return 0;
    }
    return command === 'workbench.previousPanel' ? -1 : 1;
  }

  /**
   * The panel `Tab` goes to from `groupId`: the next in layout order, or the
   * previous one, round at either end.
   */
  nextPanel(groupId: string, direction: -1 | 1): string | null {
    const panels = this.panels();
    const at = panels.indexOf(groupId);
    if (panels.length < 2) {
      return null;
    }
    const from = at === -1 ? panels.indexOf(this.parent.activeGroupId()) : at;
    return panels[(from + direction + panels.length) % panels.length] ?? null;
  }

  /** The panels `Tab` walks: all of them in layout order — only the one on screen while one is maximized. */
  private readonly panels = computed<readonly string[]>(() => {
    const maximized = this.parent.panelLayoutFt.maximizedGroupId();
    return maximized === null ? this.parent.panelLayoutFt.groupIds() : [maximized];
  });

  /** Enters a panel as choosing its tab does; `false` for a region the shell must focus. */
  enter(region: UiFocusRegionId): boolean {
    if (!region.startsWith('group:')) {
      return false;
    }
    const groupId = region.slice('group:'.length);
    this.parent.panelFocusFt.focusBody(groupId);
    this.parent.editorGroupsFt.entered(groupId);
    return true;
  }
}
