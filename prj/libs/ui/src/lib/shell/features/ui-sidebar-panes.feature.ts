import { signal, type WritableSignal } from '@angular/core';
import type { UiPaneMove, UiPaneResize } from '../../models/interaction.model';
import type { UiPaneDef } from '../ui-workbench.config';
import type { UiWorkbenchService } from '../ui-workbench.service';

/**
 * Which collapsible sidebar panes are open, and in what order they stand.
 *
 * `UiPane` is stateless — it renders the `expanded` it is given — so the open/
 * closed state of every pane of both sidebars lives here. So does their order
 * (PRD 002, §5.1): a pane dragged onto another, or moved with `Ctrl`+`↑`/`↓`,
 * is reported by the library and placed here; the sidebars draw their panes
 * in `order(sidebar)`, and the session remembers it. So does their height
 * (PRD 002, §5.2): a pane's sash reports every expanded pane's, kept here by
 * id and handed back as the pane's `size` — a weight, so the panes keep their
 * proportions as the window changes height. And which are shown at all
 * (PRD 001, §9.2): the sidebar's `…` menu hides and shows each, as VS Code's
 * does its views — never the last one shown, or the sidebar would be left
 * with nothing to bring them back by but its header.
 *
 * The panes are the configuration's (`UiSidebarDef.panes`), in the order
 * they start in.
 */
export class UiSidebarPanesFeature {
  /** Each sidebar's panes in the order they start in, by sidebar id. */
  readonly defaultOrder: Readonly<Record<string, readonly string[]>>;

  /** Panes hidden until the user shows them from the sidebar's `…` menu (PRD 001, §9.2). */
  readonly defaultHidden: readonly string[];

  private readonly expanded: WritableSignal<ReadonlySet<string>>;

  private readonly orders: WritableSignal<Readonly<Record<string, readonly string[]>>>;

  private readonly sizes = signal<Readonly<Record<string, number>>>({});

  private readonly hidden: WritableSignal<ReadonlySet<string>>;

  constructor(protected readonly parent: UiWorkbenchService) {
    const { sidebars, expandedPanes } = parent.config;
    this.defaultOrder = Object.fromEntries(sidebars.map((sidebar) => [sidebar.id, sidebar.panes.map((pane) => pane.id)]));
    this.defaultHidden = sidebars.flatMap((sidebar) => sidebar.panes.filter((pane) => pane.hidden === true).map((pane) => pane.id));
    this.expanded = signal(
      new Set([...sidebars.flatMap((sidebar) => sidebar.panes.filter((pane) => pane.expanded === true).map((pane) => pane.id)), ...(expandedPanes ?? [])]),
    );
    this.orders = signal(this.defaultOrder);
    this.hidden = signal(new Set(this.defaultHidden));
  }

  /** A pane's definition, wherever it is. */
  pane(id: string): UiPaneDef | undefined {
    return this.parent.config.sidebars.flatMap((sidebar) => sidebar.panes).find((pane) => pane.id === id);
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
  order(sidebar: string): readonly string[] {
    return this.orders()[sidebar] ?? [];
  }

  /** Every sidebar's order, for the session — only those that differ from the default. */
  changedOrders(): Readonly<Record<string, readonly string[]>> {
    const orders = this.orders();
    return Object.fromEntries(
      Object.keys(orders)
        .filter((sidebar) => (orders[sidebar] ?? []).join() !== (this.defaultOrder[sidebar] ?? []).join())
        .map((sidebar) => [sidebar, orders[sidebar] as readonly string[]]),
    );
  }

  /**
   * Puts back a remembered order. Panes it does not name — new in this
   * version — keep their place relative to the default; names it has that no
   * longer exist are dropped.
   */
  restoreOrders(saved: Readonly<Record<string, readonly string[]>>): void {
    this.orders.set(Object.fromEntries(Object.entries(this.defaultOrder).map(([sidebar, defaults]) => [sidebar, UiSidebarPanesFeature.merged(saved[sidebar], defaults)])));
  }

  /** A sidebar's panes that are shown, top to bottom — what the sidebar draws. */
  shown(sidebar: string): readonly string[] {
    const hidden = this.hidden();
    return this.order(sidebar).filter((id) => !hidden.has(id));
  }

  isShown(id: string): boolean {
    return !this.hidden().has(id);
  }

  /** Whether `id` may be hidden: not while it is the last one its sidebar shows. */
  canHide(id: string): boolean {
    const sidebar = this.sidebarOf(id);
    return sidebar !== undefined && this.isShown(id) && this.shown(sidebar).length > 1;
  }

  /** Hides a shown pane, or shows a hidden one — the `…` menu's rows. */
  toggleShown(id: string): void {
    if (this.sidebarOf(id) === undefined || (this.isShown(id) && !this.canHide(id))) {
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
    const known = ids.filter((id) => this.sidebarOf(id) !== undefined);
    const whole = Object.keys(this.defaultOrder).filter((sidebar) => (this.defaultOrder[sidebar] ?? []).every((id) => known.includes(id)));
    this.hidden.set(new Set(known.filter((id) => !whole.includes(this.sidebarOf(id) as string))));
  }

  /** The sidebar a pane belongs to, or `undefined` for one that is not a sidebar's (a view drawn in place of its panes). */
  sidebarOf(id: string): string | undefined {
    return Object.keys(this.defaultOrder).find((sidebar) => (this.defaultOrder[sidebar] ?? []).includes(id));
  }

  /** A pane dropped before or after another of the same sidebar. */
  move(sidebar: string, move: UiPaneMove): void {
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
    const sidebar = this.sidebarOf(id);
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
}
