import type { UiIconName, UiIconTint } from '../models/icon.model';

/**
 * One tab of a panel group, as the workbench keeps it: what the library needs
 * to know of every tab. An application's tabs extend it with what they show —
 * a path, a document, a query — and the library carries those fields along
 * untouched, into the session too.
 */
export interface UiTabState {
  readonly id: string;
  /** What it shows, as the application names it; `UiPanelContentDef.kinds` maps it to a kind of content. */
  readonly kind: string;
  readonly label: string;
  readonly active?: boolean;
  /**
   * The tab this one was opened from, by id — chosen again when this one is
   * closed (PRD 002, §2.5.1). Kept for the session only, never written.
   */
  readonly openedFrom?: string;
  /**
   * What the tab had when another tab of its group was chosen (PRD 001, Fix 4)
   * — the application's to say what (`UiEditorGroupsFeature.remember`). Kept
   * for the session only, never written.
   */
  readonly remembered?: unknown;
}

/** A panel group: its tabs, and whatever else the application keeps per group. */
export interface UiGroupState<TTab extends UiTabState = UiTabState> {
  readonly id: string;
  readonly tabs: readonly TTab[];
}

/** A tab's fields that a new tab is made from: everything but what the group decides. */
export type UiNewTab<TTab extends UiTabState> = Omit<TTab, 'id' | 'active' | 'remembered' | 'openedFrom'>;

/**
 * A kind of panel content (PRD 001, §17.1): the component the application
 * projects into a group for tabs of these `kinds` — `<ng-template
 * uiPanelContent="files">` — and the icon its tabs carry.
 */
export interface UiPanelContentDef {
  readonly type: string;
  readonly kinds: readonly string[];
  /** The tabs' icon in the tab bar, unless the driver says otherwise (`tabIcon`). */
  readonly icon?: UiIconName;
}

/**
 * What the groups need from whatever renders a kind of content, at run time:
 * the application's feature behind it. Every member is optional — a content
 * that loads nothing, never is loading and takes no files needs none.
 */
export interface UiPanelContentDriver<TTab extends UiTabState = UiTabState, TGroup extends UiGroupState<TTab> = UiGroupState<TTab>> {
  /** Starts fetching what the tab shows, as it becomes the one its group shows. */
  load?(tab: TTab): void;
  /** Whether the tab's content is still arriving — the group's loading rail. */
  isLoading?(group: TGroup, tab: TTab): boolean;
  /** Whether files dragged in from the system may be dropped on the tab. */
  acceptsFiles?(tab: TTab): boolean;
  /** The tab's icon, when it is not the content's. */
  tabIcon?(tab: TTab): { readonly icon: UiIconName; readonly tint?: UiIconTint };
}
