import type { UiPanelView } from '@tr-file/ui';

/**
 * What a tab is showing: a directory listing, one file read-only, or a
 * folder inside a zip (PRD 003, §6).
 */
export type PanelTabKind = 'folder' | 'file' | 'archive';

/**
 * Which kind of panel content renders a tab — one component and one feature
 * class per kind. File management is the only one so far.
 */
export type PanelContentType = 'files' | 'archive';

/**
 * The content each tab kind is rendered by. A `Record`, so a new tab kind
 * does not compile until it says which content shows it.
 */
export const PANEL_CONTENT: Readonly<Record<PanelTabKind, PanelContentType>> = {
  folder: 'files',
  file: 'files',
  archive: 'archive',
};

/** One tab of a panel group. */
export interface PanelTabState {
  readonly id: string;
  /** Basename of `path`, or the workspace name for the root. */
  readonly label: string;
  /** Root-relative path the tab shows. */
  readonly path: string;
  readonly kind: PanelTabKind;
  readonly active?: boolean;
  /** An archive tab's folder inside the archive; `''` or absent is its top. */
  readonly inner?: string;
}

/** What a listing can be ordered by: its columns (PRD 003, §5). */
export type PanelSortKey = 'name' | 'size' | 'type' | 'modified';

/** How a panel orders its listing; folders always come first, as in every file manager. */
export interface PanelSort {
  readonly key: PanelSortKey;
  readonly direction: 'asc' | 'desc';
}

/** Name, A to Z: what a panel starts with. */
export const DEFAULT_SORT: PanelSort = { key: 'name', direction: 'asc' };

/** A panel group: a set of tabs over directories, plus what is selected. */
export interface PanelGroupState {
  readonly id: string;
  /**
   * Path the group is showing — the active tab's. A folder tab lists it; a
   * file tab previews it, and the group lists nothing.
   */
  readonly path: string;
  readonly view: UiPanelView;
  readonly tabs: readonly PanelTabState[];
  /** Paths of the listed entries that are selected. */
  readonly selection: readonly string[];
  /** Entry that owns keyboard focus inside the group. */
  readonly focusedEntryId?: string;
  /** How the listing is ordered; `DEFAULT_SORT` when absent. Kept per panel, like its view. */
  readonly sort?: PanelSort;
}
