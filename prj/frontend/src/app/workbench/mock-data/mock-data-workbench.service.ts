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
   * Layout at start-up: two groups side by side on the workspace root
   * (PRD 002, §1.3) — a source and a target, as a two-panel file manager
   * starts; the left one active, so a copy from it goes to the right. The
   * backend decides what is in them; the workbench only says where to look
   * first — and on the desktop they start in the home folder instead
   * (PRD 003, §6). A restored session's layout replaces this altogether
   * (`SessionFeature`).
   */
  readonly layout: MockWorkbenchLayout = {
    grid: {
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'leaf', groupId: 'group-root', size: 1 },
        { kind: 'leaf', groupId: 'group-2', size: 1 },
      ],
    },
    groups: [
      {
        id: 'group-root',
        path: '',
        view: 'list',
        selection: [],
        tabs: [{ id: 'tab-root', label: 'tr-file', path: '', kind: 'folder', active: true }],
      },
      {
        id: 'group-2',
        path: '',
        view: 'list',
        selection: [],
        tabs: [{ id: 'tab-group-2', label: 'tr-file', path: '', kind: 'folder', active: true }],
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
   * The main menu (PRD 008, §1): which commands each menu offers, in order.
   * Labels, keys and whether a row is enabled or checked come from the
   * command table (`CommandsFeature`, PRD 003 §4–5); a row the table does not
   * know — Go's choice of computer — is shown as it is here.
   */
  readonly menuItems: readonly UiMenuBarItem[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        { id: 'file.newFile', label: 'New File…' },
        { id: 'file.newFolder', label: 'New Folder…' },
        { id: 'file.openExternal', label: 'Open with Default App', separatorBefore: true },
        { id: 'file.reveal', label: 'Reveal' },
        { id: 'file.rename', label: 'Rename…', separatorBefore: true },
        { id: 'file.copyTo', label: 'Copy To…' },
        { id: 'file.moveTo', label: 'Move To…' },
        { id: 'file.trash', label: 'Move to Trash' },
        { id: 'file.delete', label: 'Delete Permanently…' },
        { id: 'file.compress', label: 'Compress…', separatorBefore: true },
        { id: 'file.extractHere', label: 'Extract Here' },
        { id: 'file.extractTo', label: 'Extract To…' },
        { id: 'file.upload', label: 'Upload Files…', separatorBefore: true },
        { id: 'file.uploadFolder', label: 'Upload Folder…' },
        { id: 'file.download', label: 'Download' },
        { id: 'file.emptyTrash', label: 'Empty Trash…', separatorBefore: true },
        { id: 'file.checkForUpdates', label: 'Check for Updates…', separatorBefore: true },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'edit.undo', label: 'Undo' },
        { id: 'edit.cut', label: 'Cut', separatorBefore: true },
        { id: 'edit.copy', label: 'Copy' },
        { id: 'edit.paste', label: 'Paste' },
        { id: 'file.copyPath', label: 'Copy Path', separatorBefore: true },
        { id: 'edit.filter', label: 'Filter Folder', separatorBefore: true },
        { id: 'edit.search', label: 'Search Files…' },
      ],
    },
    {
      id: 'selection',
      label: 'Selection',
      items: [
        { id: 'selection.all', label: 'Select All' },
        { id: 'selection.none', label: 'Select None' },
        { id: 'selection.invert', label: 'Invert Selection' },
        { id: 'selection.byPattern', label: 'Select by Pattern…', separatorBefore: true },
        { id: 'selection.unselectByPattern', label: 'Unselect by Pattern…' },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { id: 'view.list', label: 'List' },
        { id: 'view.grid', label: 'Icons' },
        { id: 'view.tree', label: 'Tree' },
        { id: 'view.sort.name', label: 'Sort by Name', separatorBefore: true },
        { id: 'view.sort.size', label: 'Sort by Size' },
        { id: 'view.sort.type', label: 'Sort by Type' },
        { id: 'view.sort.modified', label: 'Sort by Date Modified' },
        { id: 'view.sortDescending', label: 'Descending' },
        { id: 'view.hidden', label: 'Show Hidden Files', separatorBefore: true },
        { id: 'view.refresh', label: 'Refresh' },
        { id: 'places.show', label: 'Show Bookmarks', separatorBefore: true },
        { id: 'view.toggleExplorer', label: 'Toggle Explorer' },
        { id: 'view.toggleDetails', label: 'Toggle Details' },
        { id: 'view.toggleSidebars', label: 'Toggle Explorer and Details' },
        { id: 'view.togglePanel', label: 'Toggle Panel' },
        { id: 'view.notes', label: 'Show Notes' },
        { id: 'view.resetLayout', label: 'Reset Layout' },
        // The desktop's zoom (PRD 001, §8.2.3), also the title bar's control.
        { id: 'view.zoomIn', label: 'Zoom In', separatorBefore: true },
        { id: 'view.zoomOut', label: 'Zoom Out' },
        { id: 'view.resetZoom', label: 'Reset Zoom' },
      ],
    },
    {
      id: 'go',
      label: 'Go',
      items: [
        { id: 'go.back', label: 'Back' },
        { id: 'go.forward', label: 'Forward' },
        { id: 'go.up', label: 'Up One Level' },
        { id: 'go.location', label: 'Go to Location…' },
        { id: 'places.addBookmark', label: 'Add to Bookmarks', separatorBefore: true },
        { id: 'places.removeBookmark', label: 'Remove from Bookmarks' },
        // Which one is checked follows the connection; see `ChromeFeature.menuItems`.
        { id: 'go.local', label: 'Local Computer', checked: true, separatorBefore: true },
        { id: 'go.remote', label: 'Remote Computer…', checked: false },
      ],
    },
    {
      // PRD 001, §16.
      id: 'help',
      label: 'Help',
      items: [
        { id: 'help.show', label: 'Show Help' },
        { id: 'help.cheatsheet', label: 'Keyboard Shortcuts Cheatsheet' },
      ],
    },
  ];

  /** The title bar's command centre opens the command palette (PRD 009, §1). */
  readonly commandLabel = 'Search commands…';
  readonly commandKeys: readonly string[] = ['Ctrl', 'Shift', 'P'];

  readonly titleBarActions: readonly UiIconAction[] = [
    // Its label and icon follow the theme in force; see `ChromeFeature.titleBarActions` (PRD 001, §8.2.2).
    { id: 'toggle-theme', label: 'Switch to Light Theme', icon: 'sun' },
    { id: 'toggle-left', label: 'Toggle Explorer', icon: 'sidebar-left', active: true },
    { id: 'toggle-panel', label: 'Toggle Panel', icon: 'panel-bottom', active: true },
    { id: 'toggle-right', label: 'Toggle Details', icon: 'sidebar-right', active: true },
    { id: 'customize', label: 'Reset Layout', icon: 'layout-grid' },
  ];

  readonly activityBottomItems: readonly UiActivityItem[] = [
    { id: 'account', label: 'Account', icon: 'user' },
    { id: 'settings', label: 'Settings', icon: 'settings', hasMenu: true },
  ];

  /**
   * What the Settings gear's menu offers (PRD 007, §1): commands of the table,
   * by id, as the main menu names them — what the app remembers and shows
   * (PRD 003, §6).
   */
  readonly settingsMenuItems: readonly UiMenuItem[] = [
    { id: 'workbench.openSettings', label: 'Settings' },
    { id: 'workbench.openKeybindings', label: 'Keyboard Shortcuts' },
    { id: 'view.hidden', label: 'Show Hidden Files', separatorBefore: true },
    { id: 'settings.restoreSession', label: 'Restore Layout on Start', separatorBefore: true },
    { id: 'view.resetLayout', label: 'Reset Layout' },
    { id: 'places.clearRecent', label: 'Clear Recent Folders', separatorBefore: true },
  ];

  readonly sidebarMoreActions: readonly UiIconAction[] = [
    { id: 'more', label: 'More actions', icon: 'dots' },
  ];

  /** Explorer header actions: new entries go into the folder highlighted in the tree (PRD 003, §5). */
  readonly explorerActions: readonly UiIconAction[] = [
    { id: 'new-file', label: 'New file…', icon: 'file-plus' },
    { id: 'new-folder', label: 'New folder…', icon: 'folder-plus' },
    { id: 'refresh', label: 'Refresh explorer', icon: 'refresh' },
    { id: 'collapse', label: 'Collapse all', icon: 'chevrons-up' },
  ];
}
