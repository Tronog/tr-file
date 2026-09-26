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
/** A menu's placeholder while its commands are still to come. */
const TODO: UiMenuItem = { id: 'todo', label: 'Todo', disabled: true };

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

  /**
   * The main menu (PRD 008, §1). Only Go has entries of its own so far; the
   * rest hold a placeholder until their commands exist.
   */
  readonly menuItems: readonly UiMenuBarItem[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        // File operations (PRD 005, §1); disabled while nothing is selected — see `ChromeFeature.menuItems`.
        { id: 'file.copyTo', label: 'Copy To…' },
        { id: 'file.moveTo', label: 'Move To…' },
        { id: 'file.trash', label: 'Move to Trash', keybinding: 'Delete' },
        { id: 'file.emptyTrash', label: 'Empty Trash…', separatorBefore: true },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        // The file clipboard (PRD 005, §2); what is enabled follows the selection — see `ChromeFeature.menuItems`.
        { id: 'edit.cut', label: 'Cut', keybinding: 'Ctrl+X' },
        { id: 'edit.copy', label: 'Copy', keybinding: 'Ctrl+C' },
        { id: 'edit.paste', label: 'Paste', keybinding: 'Ctrl+V' },
      ],
    },
    { id: 'selection', label: 'Selection', items: [TODO] },
    { id: 'view', label: 'View', items: [TODO] },
    {
      id: 'go',
      label: 'Go',
      items: [
        // Which one is checked follows the connection; see `ChromeFeature.menuItems`.
        { id: 'go.local', label: 'Local Computer', checked: true },
        { id: 'go.remote', label: 'Remote Computer…', checked: false },
      ],
    },
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
