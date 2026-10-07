/**
 * The vocabulary of panel interactions: dragging tabs between groups and
 * dragging the borders between regions.
 *
 * Components report intent in these terms and never change the layout
 * themselves — the feature classes in the app own the layout tree and decide
 * what a drop or a drag actually means.
 */

/** Where a dragged tab was released over a group. */
export type UiDropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** MIME type carrying a dragged tab through the HTML drag-and-drop API. */
export const UI_TAB_MIME = 'application/x-tr-file-tab';

/**
 * Files from outside the page dropped on a `UiFileBrowser` or a
 * `UiPanelGroup` (PRD 003, §6) — from the system's file manager, or, on the
 * desktop, entries of this app dragged as files. `entries` are the dropped
 * items as the browser's file-system entries, read during the drop — the only
 * moment they can be — so a folder can be walked; `files` has the same items
 * as `File`s. `target` and `copy` are as a `UiEntryDrop`'s.
 */
export interface UiFilesDrop {
  readonly files: readonly File[];
  readonly entries: readonly FileSystemEntry[];
  readonly target: string | null;
  readonly copy: boolean;
}

/** Identifies the tab being dragged and where it came from. */
export interface UiTabDragData {
  readonly tabId: string;
  readonly groupId: string;
}

/**
 * A tab released over a group's body. `center` means "join this group";
 * an edge zone means "divide this group and put the tab in the new half".
 */
export interface UiTabDrop extends UiTabDragData {
  readonly targetGroupId: string;
  readonly zone: UiDropZone;
}

/**
 * A tab released over a tab bar — a reorder when the group matches, a move
 * into that group otherwise.
 */
export interface UiTabReorder extends UiTabDragData {
  readonly targetGroupId: string;
  /** Insert before this tab; `null` appends to the end of the bar. */
  readonly beforeTabId: string | null;
}

/**
 * MIME type carrying a dragged sidebar pane (PRD 002, §5.1); the payload is
 * the pane's id.
 */
export const UI_PANE_MIME = 'application/x-tr-file-pane';

/**
 * A pane of a sidebar dropped on another of the same sidebar — or moved a slot
 * up or down with `Ctrl`+`↑`/`↓` on its header — to go before or after it.
 */
export interface UiPaneMove {
  readonly paneId: string;
  readonly targetId: string;
  readonly position: 'before' | 'after';
}

/**
 * MIME type carrying a dragged row of a reorderable `UiTree` (PRD 002, §6.1);
 * the payload is the row's id.
 */
export const UI_TREE_ROW_MIME = 'application/x-tr-file-tree-row';

/**
 * A row of a reorderable tree dropped on another row of the same tree — or
 * moved a slot up or down with `Ctrl`+`↑`/`↓` — to go before or after it.
 */
export interface UiTreeMove {
  readonly id: string;
  readonly targetId: string;
  readonly position: 'before' | 'after';
}

/**
 * The sash on a pane's top edge was dragged (PRD 002, §5.2): the height, in
 * pixels, of every expanded pane of that sidebar — the two either side of the
 * sash as moved, the rest as they stand. Given back as each pane's `size`,
 * they are weights: the panes keep these proportions as the sidebar changes
 * height.
 */
export interface UiPaneResize {
  readonly sizes: Readonly<Record<string, number>>;
}

/** A keyboard-driven tab move, one slot at a time. */
export interface UiTabMove {
  readonly tabId: string;
  /** `-1` towards the start of the bar, `1` towards the end. */
  readonly direction: -1 | 1;
}

/**
 * A right-click — or `Shift`+`F10`, or the context-menu key — on something
 * that has a menu of its own (PRD 003, §5). `(x, y)` is where the menu should
 * open, in viewport pixels; `target` is what was pressed on: an entry's id,
 * or `null` for a listing's blank space. The menu is the application's.
 */
export interface UiContextMenuRequest {
  readonly target: string | null;
  readonly x: number;
  readonly y: number;
}

/**
 * A new selection in a list or grid (PRD 004, §1.2): every selected entry, in
 * list order, and the one the cursor is on — which is what a single-entry
 * consumer, like the details sidebar, follows. `focused` is `null` only when a
 * box selection caught nothing.
 */
export interface UiSelectionChange {
  readonly selected: readonly string[];
  readonly focused: string | null;
}

/** Where a sash drag is in its lifecycle. */
export type UiSashPhase = 'start' | 'move' | 'end';

/** One step of a sash drag. */
export interface UiSashResize {
  /** Pixels travelled along the sash's axis since the previous event. */
  readonly delta: number;
  readonly phase: UiSashPhase;
}

/** New shares for the two children a grid sash separates. */
export interface UiSplitResize {
  /** Child indices from the root of the grid; `[]` addresses the root node. */
  readonly path: readonly number[];
  /** Index of the child before the dragged sash. */
  readonly index: number;
  /** Replacement `size` for children `index` and `index + 1`. */
  readonly sizes: readonly [number, number];
}
