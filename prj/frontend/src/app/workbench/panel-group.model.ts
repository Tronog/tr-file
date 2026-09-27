import type { UiPanelView } from '@tr-file/ui';

/**
 * What a tab is showing: a directory listing, one file read-only, a folder
 * inside a zip (PRD 003, §6), a file's git changes (PRD 011, §1), or the
 * trash (PRD 001, §14.1).
 */
export type PanelTabKind = 'folder' | 'file' | 'archive' | 'diff' | 'trash';

/**
 * Which kind of panel content renders a tab — one component and one feature
 * class per kind. File management is the only one so far.
 */
export type PanelContentType = 'files' | 'archive' | 'diff' | 'trash';

/**
 * The content each tab kind is rendered by. A `Record`, so a new tab kind
 * does not compile until it says which content shows it.
 */
export const PANEL_CONTENT: Readonly<Record<PanelTabKind, PanelContentType>> = {
  folder: 'files',
  file: 'files',
  archive: 'archive',
  diff: 'diff',
  trash: 'trash',
};

/** Which changes a diff tab shows: a file of a repository, staged or not (PRD 011, §1). */
export interface PanelDiffSpec {
  /** Root-relative folder of the repository. */
  readonly root: string;
  /** The file, relative to the repository. */
  readonly file: string;
  readonly staged: boolean;
}

/**
 * What a tab had selected when another tab of its panel was chosen
 * (PRD 001, Fix 4) — given back when it is chosen again.
 */
export interface PanelTabMemory {
  /** The folder it was listing then: a tab that has since moved on starts afresh. */
  readonly path: string;
  readonly selection: readonly string[];
  readonly focusedEntryId?: string;
}

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
  /** A diff tab's repository, file and side. */
  readonly diff?: PanelDiffSpec;
  /** Its selection, kept while another tab of the panel is active; see `PanelTabMemory`. */
  readonly remembered?: PanelTabMemory;
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
