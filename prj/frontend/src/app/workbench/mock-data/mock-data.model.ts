import type { UiGridNode } from '@tr-file/ui';
import type { PanelGroupState } from '../panel-group.model';

/**
 * The parts of the workbench no backend owns yet.
 *
 * Since Section 7.1 every file, listing and detail comes from `/api/fs`; what
 * is left here is the shell the session starts with — the menus, the activity
 * bar and the restored layout. When a settings or session service appears,
 * this is the seam it replaces.
 */
export interface MockWorkbenchLayout {
  /** The split tree the editor area starts with. */
  readonly grid: UiGridNode;
  readonly groups: readonly PanelGroupState[];
  /** Entry the details sidebar describes at start-up (`''` is the root). */
  readonly selectedEntryId: string;
  readonly activeGroupId: string;
  readonly leftSidebarWidth: number;
  readonly rightSidebarWidth: number;
  readonly bottomPanelHeight: number;
}
