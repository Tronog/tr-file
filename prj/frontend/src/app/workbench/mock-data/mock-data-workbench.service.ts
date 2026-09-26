import { Service } from '@angular/core';
import type { UiActivityItem, UiIconAction, UiMenuBarItem, UiMenuItem } from '@tr-file/ui';
import type { MockWorkbenchLayout } from './mock-data.model';

/**
 * The parts of the workbench no backend owns: the menus, the activity bar and
 * the layout the session starts with.
 *
 * Since Section 7.1 every file, listing and detail comes from `/api/fs`; this
 * is what is left, and it is the seam a future settings or session service
 * replaces. Everything here is data — the features turn it into view models.
 */
@Service()
export class MockDataWorkbenchService {
  /**
   * Layout at start-up: one group on the workspace root. The backend decides
   * what is in it; the workbench only says where to look first.
   */
  readonly layout: MockWorkbenchLayout = {
    grid: { kind: 'leaf', groupId: 'group-root', size: 1 },
    groups: [
      {
        id: 'group-root',
        path: '',
        view: 'list',
        selection: [],
        tabs: [{ id: 'tab-root', label: 'tr-file', path: '', kind: 'folder', active: true }],
      },
    ],
    selectedEntryId: '',
    activeGroupId: 'group-root',
    leftSidebarWidth: 280,
    rightSidebarWidth: 320,
    bottomPanelHeight: 200,
  };

  /** Name shown for the backend's files root, which the API never discloses. */
  readonly workspaceName = 'tr-file';

  /* -- chrome ------------------------------------------------------------ */

  readonly menuItems: readonly UiMenuBarItem[] = [
    { id: 'file', label: 'File' },
    { id: 'edit', label: 'Edit' },
    { id: 'selection', label: 'Selection' },
    { id: 'view', label: 'View' },
    { id: 'go', label: 'Go' },
    { id: 'transfer', label: 'Transfer' },
    { id: 'help', label: 'Help' },
  ];

  /** The title bar's command centre opens the command palette (PRD 009, §1). */
  readonly commandLabel = 'Search commands…';
  readonly commandKeys: readonly string[] = ['Ctrl', 'Shift', 'P'];

  readonly titleBarActions: readonly UiIconAction[] = [
    { id: 'toggle-left', label: 'Toggle left sidebar', icon: 'sidebar-left', active: true },
    { id: 'toggle-panel', label: 'Toggle bottom panel', icon: 'panel-bottom', active: true },
    { id: 'toggle-right', label: 'Toggle right sidebar', icon: 'sidebar-right', active: true },
    { id: 'customize', label: 'Customize layout', icon: 'layout-grid' },
  ];

  readonly activityBottomItems: readonly UiActivityItem[] = [
    { id: 'account', label: 'Account', icon: 'user' },
    { id: 'settings', label: 'Settings', icon: 'settings', hasMenu: true },
  ];

  /**
   * What the Settings gear's menu offers (PRD 007, §1). A placeholder for now:
   * the settings themselves are still to come.
   */
  readonly settingsMenuItems: readonly UiMenuItem[] = [{ id: 'todo', label: 'Todo', disabled: true }];

  readonly sidebarMoreActions: readonly UiIconAction[] = [
    { id: 'more', label: 'More actions', icon: 'dots' },
  ];

  /**
   * Explorer header actions. Creating files and folders is not part of the
   * `/api/fs` contract yet, so only the two that work are offered.
   */
  readonly explorerActions: readonly UiIconAction[] = [
    { id: 'refresh', label: 'Refresh explorer', icon: 'refresh' },
    { id: 'collapse', label: 'Collapse all', icon: 'chevrons-up' },
  ];
}
