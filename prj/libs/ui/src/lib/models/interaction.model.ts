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

/** A keyboard-driven tab move, one slot at a time. */
export interface UiTabMove {
  readonly tabId: string;
  /** `-1` towards the start of the bar, `1` towards the end. */
  readonly direction: -1 | 1;
}

/**
 * A key pressed inside a panel body whose meaning belongs to the application.
 *
 * Moving focus stays with the component: it is DOM work, and a roving
 * tabindex can only be rolled where the elements are. Everything that changes
 * what the workbench *shows* leaves as one of these instead, so a panel's key
 * bindings are decided in one place rather than spread across a template.
 */
export type UiPanelCommand = 'open' | 'select' | 'up' | 'refresh' | 'back' | 'forward';

/**
 * One `UiPanelCommand`, with the entry focus sat on when the key was hit.
 *
 * `back` and `forward` carry an entry like the rest, but never use one: they
 * are about where the *panel* has been, not what is selected in it.
 */
export interface UiPanelKey {
  readonly command: UiPanelCommand;
  /** `null` when the body lists nothing — `up` and `refresh` still apply. */
  readonly entryId: string | null;
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
