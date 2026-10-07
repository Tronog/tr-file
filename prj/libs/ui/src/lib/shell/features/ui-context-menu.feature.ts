import { computed, signal } from '@angular/core';
import type { UiMenuItem } from '../../models/chrome.model';
import type { UiContextMenuRequest } from '../../models/interaction.model';
import type { UiCommandTarget } from '../ui-commands.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

/** A context menu on screen: where, what it offers, and what its commands act on. */
export interface UiOpenContextMenu<T extends UiCommandTarget = UiCommandTarget> {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly UiMenuItem[];
  readonly target: T;
}

/** A menu's rows by command id; `'-'` starts a new section, drawn as a separator. */
export type UiMenuLayout = readonly string[];

/** A tab's menu, unless the application lays out its own (`UiWorkbenchConfig.tabMenu`). */
const TAB: UiMenuLayout = ['tab.close', 'tab.closeOthers', 'tab.closeRight'];

/**
 * The right-click menus (PRD 003, §5) — and `Shift`+`F10` for each.
 *
 * Every row is a command of the table, laid out per kind of target, so a
 * right-click offers nothing the menus and the palette do not, enabled by
 * the same rules; a row that does not apply is shown disabled rather than
 * left out, so the menu keeps its shape. The library has a tab's menu and a
 * sidebar's `…`; an application opens its own with `show`.
 */
export class UiContextMenuFeature<T extends UiCommandTarget = UiCommandTarget> {
  private readonly current = signal<UiOpenContextMenu<T> | null>(null);

  constructor(protected readonly parent: UiWorkbenchService) {}

  readonly menu = this.current.asReadonly();

  /**
   * The open menu as a list of one, for the template to track by identity: a
   * second right-click is a new menu — placed, and focused, afresh — not the
   * old one with new rows.
   */
  readonly menus = computed<readonly UiOpenContextMenu<T>[]>(() => {
    const menu = this.current();
    return menu === null ? [] : [menu];
  });

  /** A right-click on a tab. */
  openOnTab(groupId: string, request: UiContextMenuRequest): void {
    if (request.target === null) {
      return;
    }
    this.show(request, 'Tab actions', this.parent.config.tabMenu ?? TAB, this.parent.commandsFt.tabTarget(groupId, request.target) as T);
  }

  /**
   * A sidebar's `…` (PRD 001, §9.2): its panes, in the order they stand, each
   * checked while shown — choosing one hides or shows it.
   */
  openSidebarMenu(sidebar: string, x: number, y: number): void {
    const panes = this.parent.sidebarPanesFt;
    const label = this.parent.config.sidebars.find((candidate) => candidate.id === sidebar)?.label ?? sidebar;
    const layout = panes.order(sidebar).map((id) => `view.pane.${id}`);
    this.show({ target: null, x, y }, `${label} views`, layout, this.parent.commandsFt.activeTarget() as T);
  }

  /** A row was chosen: the menu closes, and its command runs against what was right-clicked. */
  run(id: string): void {
    const menu = this.current();
    this.close();
    if (menu !== null) {
      this.parent.commandsFt.run(id, menu.target);
    }
  }

  close(): void {
    this.current.set(null);
  }

  /** Opens a menu of `layout`'s commands at the request's place, acting on `target`. */
  show(request: UiContextMenuRequest, label: string, layout: UiMenuLayout, target: T): void {
    const commands = this.parent.commandsFt;
    const items: UiMenuItem[] = [];
    let separate = false;
    for (const id of layout) {
      if (id === '-') {
        separate = items.length > 0;
        continue;
      }
      items.push(commands.menuItem(id, target, separate));
      separate = false;
    }
    this.current.set({ x: request.x, y: request.y, label, items, target });
  }
}
