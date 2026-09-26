import type { PanelGroupState, PanelTabState } from './panel-group.model';

/**
 * What `EditorGroupsFeature` needs from the feature behind a kind of panel
 * content (see `PANEL_CONTENT`).
 *
 * The group feature keeps the groups and their tabs — splitting, moving,
 * closing — and knows nothing of what a tab shows. Whenever a tab starts
 * showing, or the group frame needs to know about it, it asks the tab's
 * content feature through this interface. Everything else a content feature
 * does — its own view model, toolbar and navigation — is bound directly in the
 * workbench template to the component that renders it.
 */
export interface PanelContentFeature {
  /**
   * Starts fetching whatever the tab shows. Called when the tab becomes the
   * one its group is showing: at start-up, when it is chosen, when it lands in
   * another group.
   */
  load(tab: PanelTabState): void;

  /** Whether the tab's content is still arriving — the group's loading rail. */
  isLoading(group: PanelGroupState, tab: PanelTabState): boolean;

  /** Whether files dragged in from the desktop may be dropped on the tab. */
  acceptsFiles(tab: PanelTabState): boolean;
}
