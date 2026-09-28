import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiPaneMove } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** Panes that start expanded; everything else starts collapsed. */
const INITIALLY_EXPANDED = [
  'bookmarks',
  'explorer-tree',
  'search-results',
  'properties',
  'permissions',
  'tags',
  'git',
  'open-with',
] as const;

/** The sidebars whose panes can be rearranged (PRD 002, §5.1). */
export type SidebarId = 'explorer' | 'details';

/**
 * Every movable pane of each sidebar, in the order they start in. Git is at the
 * top of Details (PRD 011, §2.1); `open-with` is its Actions pane.
 */
export const DEFAULT_PANE_ORDER: Readonly<Record<SidebarId, readonly string[]>> = {
  explorer: ['places', 'bookmarks', 'recent', 'explorer-tree'],
  details: ['git', 'properties', 'permissions', 'open-with'],
};

/**
 * Which collapsible sidebar panes are open, and in what order they stand.
 *
 * `ui-pane` is stateless — it renders the `expanded` it is given — so the open/
 * closed state of every pane in both sidebars lives here. So does their order
 * (PRD 002, §5.1): a pane dragged onto another, or moved with `Ctrl`+`↑`/`↓`,
 * is reported by the library and placed here; the templates draw the panes in
 * `order(sidebar)`, and the session remembers it.
 */
export class SidebarPanesFeature {
  private readonly expanded: WritableSignal<ReadonlySet<string>>;

  private readonly orders = signal<Readonly<Record<SidebarId, readonly string[]>>>(DEFAULT_PANE_ORDER);

  constructor(private readonly parent: WorkbenchService) {
    // Places are the desktop's (PRD 003, §6): a server names its root and no
    // more, so in a browser the pane starts closed — and asks when opened.
    this.expanded = signal<ReadonlySet<string>>(
      new Set([...INITIALLY_EXPANDED, ...(parent.fileSystem.transport.systemShell ? ['places'] : [])]),
    );
  }

  /** Read in templates as `panes.isExpanded('tags')`. */
  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  /** Every open pane, for the session to remember (PRD 003, §6). */
  expandedIds(): readonly string[] {
    return [...this.expanded()].sort();
  }

  /** Opens exactly these panes, as a restored session had them. */
  restore(ids: readonly string[]): void {
    this.expanded.set(new Set(ids));
  }

  /** Opens a pane, if it is not open already. */
  expand(id: string): void {
    if (!this.isExpanded(id)) {
      this.toggle(id);
    }
  }

  toggle(id: string): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** A sidebar's panes, top to bottom; read in templates as `panes.order('details')`. */
  order(sidebar: SidebarId): readonly string[] {
    return this.orders()[sidebar];
  }

  /** Both sidebars' orders, for the session — only those that differ from the default. */
  changedOrders(): Partial<Record<SidebarId, readonly string[]>> {
    const orders = this.orders();
    return Object.fromEntries(
      (Object.keys(orders) as SidebarId[])
        .filter((sidebar) => orders[sidebar].join() !== DEFAULT_PANE_ORDER[sidebar].join())
        .map((sidebar) => [sidebar, orders[sidebar]]),
    );
  }

  /**
   * Puts back a remembered order. Panes it does not name — new in this
   * version — keep their place relative to the default; names it has that no
   * longer exist are dropped.
   */
  restoreOrders(saved: Partial<Record<SidebarId, readonly string[]>>): void {
    this.orders.set({
      explorer: SidebarPanesFeature.merged(saved.explorer, DEFAULT_PANE_ORDER.explorer),
      details: SidebarPanesFeature.merged(saved.details, DEFAULT_PANE_ORDER.details),
    });
  }

  /** A pane dropped before or after another of the same sidebar. */
  move(sidebar: SidebarId, move: UiPaneMove): void {
    const order = this.order(sidebar);
    if (move.paneId === move.targetId || !order.includes(move.paneId) || !order.includes(move.targetId)) {
      return;
    }
    const rest = order.filter((id) => id !== move.paneId);
    const at = rest.indexOf(move.targetId) + (move.position === 'after' ? 1 : 0);
    const next = [...rest.slice(0, at), move.paneId, ...rest.slice(at)];
    this.orders.update((orders) => ({ ...orders, [sidebar]: next }));
  }

  private static merged(saved: readonly string[] | undefined, defaults: readonly string[]): readonly string[] {
    const known = (saved ?? []).filter((id, index, all) => defaults.includes(id) && all.indexOf(id) === index);
    const result = [...known];
    defaults.forEach((id, index) => {
      if (result.includes(id)) {
        return;
      }
      // After the pane it follows by default, or first when it leads.
      const before = defaults.slice(0, index).reverse().find((other) => result.includes(other));
      result.splice(before === undefined ? 0 : result.indexOf(before) + 1, 0, id);
    });
    return result;
  }

  /**
   * The Details pane the entry's card goes above: the first one about the entry,
   * so Git — about the folder — can stand above the card or below it.
   */
  readonly detailsCardBefore = computed(() => this.order('details').find((id) => id !== 'git'));

  /** The details sidebar collapses entirely when nothing is selected. */
  readonly detailsVisible = computed(() => this.parent.detailsFt.hasDetails());
}
