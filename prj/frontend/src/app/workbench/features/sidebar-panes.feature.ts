import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiPaneMove, UiPaneResize } from '@tr-file/ui';
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
 * `order(sidebar)`, and the session remembers it. So does their height
 * (PRD 002, §5.2): a pane's sash reports every expanded pane's, kept here by
 * id and handed back as the pane's `size` — a weight, so the panes keep their
 * proportions as the window changes height.
 */
export class SidebarPanesFeature {
  private readonly expanded: WritableSignal<ReadonlySet<string>>;

  private readonly orders = signal<Readonly<Record<SidebarId, readonly string[]>>>(DEFAULT_PANE_ORDER);

  private readonly sizes = signal<Readonly<Record<string, number>>>({});

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
    if (!this.isExpanded(id)) {
      this.shareOnOpen(id);
    }
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

  /** A pane's height as a weight among its sidebar's, or `null` while it sizes itself. */
  sizeOf(id: string): number | null {
    return this.sizes()[id] ?? null;
  }

  /** A pane's sash was dragged: the heights of every expanded pane of that sidebar. */
  resize(resize: UiPaneResize): void {
    const valid = Object.entries(resize.sizes).filter(([, size]) => Number.isFinite(size) && size > 0);
    this.sizes.update((sizes) => ({ ...sizes, ...Object.fromEntries(valid.map(([id, size]) => [id, Math.round(size)])) }));
  }

  /** Every pane's height, for the session. */
  paneSizes(): Readonly<Record<string, number>> {
    return this.sizes();
  }

  /** Puts back remembered heights. */
  restoreSizes(sizes: Readonly<Record<string, number>>): void {
    this.sizes.set(sizes);
  }

  /**
   * A pane never sized, opened in a sidebar whose open panes are, takes an
   * equal share of it — the average of theirs. Left to size itself it would
   * weigh one pixel against their hundreds and all but vanish.
   */
  private shareOnOpen(id: string): void {
    const sidebar = (Object.keys(DEFAULT_PANE_ORDER) as SidebarId[]).find((key) => DEFAULT_PANE_ORDER[key].includes(id));
    if (sidebar === undefined || this.sizeOf(id) !== null) {
      return;
    }
    const others = this.order(sidebar)
      .filter((other) => other !== id && this.isExpanded(other))
      .map((other) => this.sizeOf(other))
      .filter((size): size is number => size !== null);
    if (others.length > 0) {
      this.resize({ sizes: { [id]: others.reduce((sum, size) => sum + size, 0) / others.length } });
    }
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
