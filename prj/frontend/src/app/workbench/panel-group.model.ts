import type { UiPanelView } from '@tr-file/ui';

/** What a tab is showing: a directory listing, or one file read-only. */
export type PanelTabKind = 'folder' | 'file';

/** One tab of a panel group. */
export interface PanelTabState {
  readonly id: string;
  /** Basename of `path`, or the workspace name for the root. */
  readonly label: string;
  /** Root-relative path the tab shows. */
  readonly path: string;
  readonly kind: PanelTabKind;
  readonly active?: boolean;
}

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
}
