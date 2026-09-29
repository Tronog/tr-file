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

/** Panes hidden until the user shows them from the sidebar's `…` menu (PRD 001, §9.2). */
export const DEFAULT_HIDDEN_PANES: readonly string[] = ['permissions'];

/** What each pane is called where it is named apart from its header: the sidebar's `…` menu (PRD 001, §9.2). */
export const PANE_LABELS: Readonly<Record<string, string>> = {
  places: 'Places',
  bookmarks: 'Bookmarks',
  recent: 'Recent',
  // Its header is the root's name; `CommandsFeature` shows that instead.
  'explorer-tree': 'Folders',
  git: 'Git',
  properties: 'Properties',
  permissions: 'Permissions',
  'open-with': 'Actions',
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
 * proportions as the window changes height. And which are shown at all
 * (PRD 001, §9.2): the sidebar's `…` menu hides and shows each, as VS Code's
 * does its views — never the last one shown, or the sidebar would be left
 * with nothing to bring them back by but its header.
 */
export class SidebarPanesFeature {
  private readonly expanded: WritableSignal<ReadonlySet<string>>;

  private readonly orders = signal<Readonly<Record<SidebarId, readonly string[]>>>(DEFAULT_PANE_ORDER);

  private readonly sizes = signal<Readonly<Record<string, number>>>({});

  private readonly hidden = signal<ReadonlySet<string>>(new Set(DEFAULT_HIDDEN_PANES));

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

  /** A sidebar's panes that are shown, top to bottom — what the templates draw. */
  shown(sidebar: SidebarId): readonly string[] {
    const hidden = this.hidden();
    return this.order(sidebar).filter((id) => !hidden.has(id));
  }

  isShown(id: string): boolean {
    return !this.hidden().has(id);
  }

  /** Whether `id` may be hidden: not while it is the last one its sidebar shows. */
  canHide(id: string): boolean {
    const sidebar = SidebarPanesFeature.sidebarOf(id);
    return sidebar !== undefined && this.isShown(id) && this.shown(sidebar).length > 1;
  }

  /** Hides a shown pane, or shows a hidden one — the `…` menu's rows. */
  toggleShown(id: string): void {
    if (SidebarPanesFeature.sidebarOf(id) === undefined || (this.isShown(id) && !this.canHide(id))) {
      return;
    }
    this.hidden.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** The hidden panes, for the session. */
  hiddenIds(): readonly string[] {
    return [...this.hidden()].sort();
  }

  /** Hides exactly these panes, as a restored session had them — but never every pane of a sidebar. */
  restoreHidden(ids: readonly string[]): void {
    const known = ids.filter((id) => SidebarPanesFeature.sidebarOf(id) !== undefined);
    const whole = (Object.keys(DEFAULT_PANE_ORDER) as SidebarId[]).filter((sidebar) =>
      DEFAULT_PANE_ORDER[sidebar].every((id) => known.includes(id)),
    );
    this.hidden.set(new Set(known.filter((id) => !whole.includes(SidebarPanesFeature.sidebarOf(id) as SidebarId))));
  }

  /** The sidebar a pane belongs to, or `undefined` for one that is not movable (search results). */
  static sidebarOf(id: string): SidebarId | undefined {
    return (Object.keys(DEFAULT_PANE_ORDER) as SidebarId[]).find((sidebar) => DEFAULT_PANE_ORDER[sidebar].includes(id));
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
    const sidebar = SidebarPanesFeature.sidebarOf(id);
    if (sidebar === undefined || this.sizeOf(id) !== null) {
      return;
    }
    const others = this.shown(sidebar)
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
   * The Details pane the entry's card goes above: the first one shown about the
   * entry, so Git — about the folder — can stand above the card or below it.
   * `undefined` when none of them is shown: the card then goes last.
   */
  readonly detailsCardBefore = computed(() => this.shown('details').find((id) => id !== 'git'));

  /** The details sidebar collapses entirely when nothing is selected. */
  readonly detailsVisible = computed(() => this.parent.detailsFt.hasDetails());
}
