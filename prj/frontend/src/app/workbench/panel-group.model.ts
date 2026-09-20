import type { UiPanelView } from '@tr-file/ui';

/** One tab of a panel group: a directory the group can switch to. */
export interface PanelTabState {
  readonly id: string;
  /** Basename of `path`, or `'/'` for the root. */
  readonly label: string;
  /** Root-relative path the tab shows. */
  readonly path: string;
  readonly active?: boolean;
}

/** A panel group: a set of tabs over directories, plus what is selected. */
export interface PanelGroupState {
  readonly id: string;
  /** Directory the group currently lists — the active tab's path. */
  readonly path: string;
  readonly view: UiPanelView;
  readonly tabs: readonly PanelTabState[];
  /** Paths of the listed entries that are selected. */
  readonly selection: readonly string[];
  /** Entry that owns keyboard focus inside the group. */
  readonly focusedEntryId?: string;
}
