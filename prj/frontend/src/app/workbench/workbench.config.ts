import {
  uiColorThemePreference,
  uiResetLayoutPreference,
  uiRestoreLayoutPreference,
  uiSidebarLocationPreference,
  type UiHelpConfig,
  type UiPreference,
  type UiSidebarDef,
  type UiWorkbenchConfig,
} from '@tr-file/ui';
import { BOOKMARK_KEYS, openBookmarkCommand } from './features/places.feature';
import { WORKBENCH_DEFAULT_KEYBINDINGS } from './features/keybindings.feature';
import type { MockDataWorkbenchService } from './mock-data/mock-data-workbench.service';
import type { PanelDiffSpec, PanelGroupState, PanelSort, PanelTabState } from './panel-group.model';
import type { UiPanelView } from '@tr-file/file-ui';

/**
 * tr-file's workbench (PRD 001, §17.1): what the library's shell
 * (`UiWorkbenchService`, `<ui-workbench-shell>`) is told about it, as data —
 * the sub-applications, the sidebars and their panes, the bottom panel, the
 * menus, the keys, the settings and the Help window's cards. What it does is
 * `WorkbenchService` and its features.
 */
export type TrFileWorkbenchConfig = UiWorkbenchConfig<PanelTabState, PanelGroupState>;

/** The two sidebars: the Explorer on the left, Details on the right (PRD 001, §9), until the settings move them (PRD 010, §3). */
export const EXPLORER: UiSidebarDef = {
  id: 'explorer',
  label: 'Explorer',
  side: 'left',
  toggleCommand: 'view.toggleExplorer',
  locationSetting: 'workbench.explorerLocation',
  panes: [
    { id: 'places', label: 'Places' },
    { id: 'bookmarks', label: 'Bookmarks', expanded: true },
    { id: 'recent', label: 'Recent' },
    // Its header is the root's name; `CommandsFeature` shows that instead.
    { id: 'explorer-tree', label: 'Folders', expanded: true },
  ],
};

/** Git is at the top of Details (PRD 011, §2.1); `open-with` is its Actions pane; Permissions starts hidden (PRD 001, §9.2). */
export const DETAILS: UiSidebarDef = {
  id: 'details',
  label: 'Details',
  side: 'right',
  toggleCommand: 'view.toggleDetails',
  locationSetting: 'workbench.detailsLocation',
  panes: [
    { id: 'git', label: 'Git', expanded: true },
    { id: 'properties', label: 'Properties', expanded: true },
    { id: 'permissions', label: 'Permissions', expanded: true, hidden: true },
    { id: 'open-with', label: 'Actions', expanded: true },
  ],
};

/**
 * Every setting the settings window shows (PRD 010, §1). Hidden files and
 * restoring the layout are kept where they were already (the session); the
 * others under `tr-file.preferences.v1`, only while they differ from their
 * default.
 */
export const PREFERENCES: readonly UiPreference[] = [
  {
    id: 'files.showHidden',
    section: 'general',
    group: 'Files',
    category: 'Files',
    title: 'Show Hidden Files',
    description: 'Show files and folders whose names start with a dot, in the panels and the explorer.',
    kind: { type: 'boolean', default: false },
  },
  {
    id: 'files.autoRefresh',
    section: 'general',
    group: 'Files',
    category: 'Files',
    title: 'Auto Refresh',
    description: 'Read the folders on screen again when something else changes them on disk.',
    kind: { type: 'boolean', default: true },
  },
  uiRestoreLayoutPreference(),
  uiResetLayoutPreference(),
  {
    id: 'places.clearRecent',
    section: 'general',
    group: 'Places',
    category: 'Places',
    title: 'Clear Recent Folders',
    description: 'Forget the folders listed under Recent in the explorer.',
    kind: { type: 'action', label: 'Clear Recent Folders', command: 'places.clearRecent' },
  },
  {
    id: 'workbench.functionKeyBar',
    section: 'appearance',
    group: 'Workbench',
    category: 'Workbench',
    title: 'Function Key Bar',
    description: "Show Midnight Commander's function keys in the middle of the status bar.",
    kind: { type: 'boolean', default: true },
  },
  uiColorThemePreference(),
  uiSidebarLocationPreference(EXPLORER, 'Which side of the window the Explorer is on, with the activity bar beside it.'),
  uiSidebarLocationPreference(
    DETAILS,
    'Which side of the window the Details sidebar is on. On the same side as the Explorer, it stands beside it, nearer the panels.',
  ),
  {
    id: 'files.thumbnails',
    section: 'appearance',
    group: 'Files',
    category: 'Files',
    title: 'Thumbnails',
    description: 'Draw a small picture of each image in the icon view, instead of its file icon.',
    kind: { type: 'boolean', default: true },
  },
];

/** The function keys, in the order the strip shows them (PRD 004, §2). */
export const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] as const;

/**
 * The Help window's cheatsheet (PRD 001, §16.1): the configurable keys by
 * subject — as `SHORTCUTS.md` groups them —, the function keys on a card of
 * their own, and the keys no one can change.
 */
export const HELP: UiHelpConfig = {
  subjects: [
    {
      id: 'window',
      title: 'Window',
      hue: 'blue',
      commands: [
        'view.commandPalette',
        'edit.search',
        'view.hidden',
        'workbench.openSettings',
        'view.togglePanel',
        'view.toggleExplorer',
        'view.toggleDetails',
        'view.toggleSidebars',
        'file.checkForUpdates',
        'workbench.focusNextPart',
        'workbench.focusPreviousPart',
      ],
    },
    {
      id: 'panels',
      title: 'Panels and tabs',
      hue: 'purple',
      commands: [
        'workbench.nextPanel',
        'workbench.previousPanel',
        'view.splitRight',
        'tab.new',
        'tab.close',
        'tab.previous',
        'tab.next',
        'view.toggleMaximize',
        'file.openToSide',
        'panel.contextMenu',
      ],
    },
    {
      id: 'files',
      title: 'Folders and files',
      hue: 'green',
      commands: [
        'file.open',
        'go.back',
        'go.forward',
        'go.up',
        'view.refresh',
        'view.stopLoading',
        'go.location',
        'edit.filter',
        'file.newFolder',
        'edit.copy',
        'edit.cut',
        'edit.paste',
        'edit.undo',
        'file.copyPath',
        'file.trash',
        'file.delete',
      ],
    },
    {
      id: 'selection',
      title: 'Selection',
      hue: 'orange',
      commands: ['list.select', 'list.toggleSelection', 'list.mark', 'list.toggleAll', 'selection.all', 'selection.byPattern', 'selection.unselectByPattern'],
    },
    {
      id: 'image',
      title: 'Image viewer',
      hue: 'pink',
      commands: ['image.previous', 'image.next', 'image.zoomIn', 'image.zoomOut', 'image.actualSize', 'image.fit'],
    },
    {
      id: 'bookmarks',
      title: 'Bookmarks',
      hue: 'yellow',
      commands: Array.from({ length: BOOKMARK_KEYS }, (_, index) => openBookmarkCommand(index + 1)),
    },
  ],
  keyCard: { id: 'function-keys', title: 'Function keys', hue: 'teal', note: 'Midnight Commander’s, shown in the status bar.', keys: FUNCTION_KEYS },
  fixed: [
    {
      id: 'listing',
      title: 'Moving in a listing',
      hue: 'teal',
      rows: [
        [[['↑'], ['↓']], 'Move the cursor; the selection follows'],
        [[['Home'], ['End']], 'First / last entry'],
        [[['PageUp'], ['PageDown']], 'A page up / down'],
        [[['Shift', '↑'], ['Shift', '↓']], 'Extend the selection'],
        [[['Ctrl', '↓']], 'Move the cursor, leaving the selection alone'],
        [[['a…z']], 'Type-to-find: jump to the next name starting with it'],
        [[['→'], ['←']], 'Tree view: open a folder in place / close it'],
      ],
    },
    {
      id: 'tree',
      title: 'Explorer tree',
      hue: 'yellow',
      rows: [
        [[['↑'], ['↓']], 'Move through the folders'],
        [[['→'], ['←']], 'Open / close a folder, or step to its child / parent'],
        [[['Shift', 'F10'], ['ContextMenu']], 'Context menu'],
      ],
    },
    {
      id: 'tab-bar',
      title: 'Tab bar',
      hue: 'purple',
      rows: [
        [[['←'], ['→']], 'Move between tabs'],
        [[['Ctrl', '←'], ['Ctrl', '→']], 'Move the tab left / right'],
        [[['Delete'], ['Backspace']], 'Close the tab'],
      ],
    },
    {
      id: 'path-bar',
      title: 'Filter box and path bar',
      hue: 'green',
      rows: [
        [[['Escape']], 'Filter: clear it; again, back to the listing'],
        [[['Enter']], 'Path bar: go to the chosen suggestion, or the path typed'],
        [[['↓'], ['↑']], 'Path bar: choose among the suggestions'],
        [[['Tab']], 'Path bar: complete to the chosen suggestion'],
        [[['Escape']], 'Path bar: close the suggestions; again, cancel'],
      ],
    },
    {
      id: 'image-fixed',
      title: 'Image viewer (zoomed)',
      hue: 'pink',
      rows: [[[['←'], ['↑'], ['→'], ['↓']], 'Pan a zoomed image']],
    },
    {
      id: 'sidebars',
      title: 'Sidebars',
      hue: 'blue',
      rows: [
        [[['Ctrl', '↑'], ['Ctrl', '↓']], 'On a section header: move the section'],
        [[['Ctrl', '↑'], ['Ctrl', '↓']], 'On a bookmark: move it up / down'],
        [[['↑'], ['↓']], 'On a section’s resize handle: resize'],
        [[['←'], ['→']], 'On a sidebar’s edge: resize the sidebar'],
        [[['Ctrl', 'Enter']], 'Git message box: commit'],
      ],
    },
    {
      id: 'zoom',
      title: 'Zoom (desktop)',
      hue: 'teal',
      rows: [
        [[['Ctrl', '='], ['Ctrl', '+']], 'Zoom in'],
        [[['Ctrl', '-']], 'Zoom out'],
        [[['Ctrl', '0']], 'Back to 100 %'],
      ],
    },
    {
      id: 'pickers',
      title: 'Command palette and pickers',
      hue: 'orange',
      rows: [
        [[['↑'], ['↓']], 'Move through the items'],
        [[['Enter']], 'Run / accept'],
        [[['Escape']], 'Close'],
        [[['F2']], 'A saved server: edit it'],
        [[['Shift', 'Delete']], 'A saved server: remove it'],
      ],
    },
    {
      id: 'dialogs',
      title: 'Dialogs',
      hue: 'red',
      rows: [
        [[['Enter']], 'In a text field: the first button'],
        [[['←'], ['→']], 'Move between the buttons'],
        [[['Escape']], 'Close without an answer'],
      ],
    },
  ],
};

/** The commands that are keys only — the file manager's components' gestures — named for the Keyboard Shortcuts page and the cheatsheet. */
const KEY_COMMANDS: Readonly<Record<string, { readonly category: string; readonly label: string }>> = {
  'list.select': { category: 'List', label: 'Select Entry' },
  'list.toggleSelection': { category: 'List', label: 'Toggle Selection' },
  'list.mark': { category: 'List', label: 'Mark Entry and Move Down' },
  'list.toggleAll': { category: 'List', label: 'Select All or None' },
  'panel.contextMenu': { category: 'Panel', label: 'Show Context Menu' },
  'view.stopLoading': { category: 'View', label: 'Stop Reading the Folder' },
  'image.previous': { category: 'Image', label: 'Previous Image in Folder' },
  'image.next': { category: 'Image', label: 'Next Image in Folder' },
};

const VIEWS: ReadonlySet<string> = new Set<UiPanelView>(['list', 'grid', 'tree']);
const SORT_KEYS: ReadonlySet<string> = new Set<PanelSort['key']>(['name', 'size', 'type', 'modified']);

/** A diff tab's repository, file and side (PRD 011, §1), or `null` when it is not one. */
function diffSpec(value: unknown): PanelDiffSpec | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  return typeof raw['root'] === 'string' && typeof raw['file'] === 'string' && typeof raw['staged'] === 'boolean'
    ? { root: raw['root'], file: raw['file'], staged: raw['staged'] }
    : null;
}

/** What tr-file's workbench is: `seed` the menus and the layout it starts with; `systemShell` on the desktop; `scope` the backend's session. */
export function trFileWorkbenchConfig(seed: MockDataWorkbenchService, systemShell = false, scope: () => string = () => 'local'): TrFileWorkbenchConfig {
  return {
    title: 'tr-file',
    icon: 'folder-open',
    layout: seed.layout,
    subApps: [
      { id: 'file-manager', label: 'File Manager', icon: 'copy', main: true },
      { id: 'search', label: 'Search', icon: 'search' },
      { id: 'disk-usage', label: 'Disk Usage', icon: 'database' },
    ],
    // Places are the desktop's (PRD 003, §6): a server names its root and no
    // more, so in a browser the pane starts closed — and asks when opened.
    sidebars: [{ ...EXPLORER, panes: EXPLORER.panes.map((pane) => (pane.id === 'places' ? { ...pane, expanded: systemShell } : pane)) }, DETAILS],
    // The Search view's one pane, drawn in place of the Explorer's (PRD 003, §5).
    expandedPanes: ['search-results'],
    sidebarActions: seed.sidebarMoreActions,
    bottomPanel: {
      label: 'Workbench panel',
      tabs: [
        { id: 'transfers', label: 'Transfers' },
        { id: 'progress', label: 'Progress' },
        { id: 'problems', label: 'Problems' },
        { id: 'notes', label: 'Notes' },
      ],
      // Every start is on Notes (PRD 001, §12.2).
      defaultTab: 'notes',
    },
    menus: seed.menuItems,
    settingsMenu: seed.settingsMenuItems,
    activityItems: [
      { id: 'transfers', label: 'Transfers', icon: 'download', separatorBefore: true },
      { id: 'bookmarks', label: 'Bookmarks', icon: 'star' },
    ],
    activityBottomItems: seed.activityBottomItems,
    titleBarActions: [
      // Leftmost of the group (PRD 001, §8.2.2): the sun in the dark, the moon in the light.
      { id: 'toggle-theme', label: 'Switch to Light Theme', icon: 'sun', command: 'view.toggleTheme', toggles: 'theme' },
      { id: 'toggle-left', label: 'Toggle Explorer', icon: 'sidebar-left', command: 'view.toggleExplorer', toggles: 'sidebar:explorer' },
      { id: 'toggle-panel', label: 'Toggle Panel', icon: 'panel-bottom', command: 'view.togglePanel', toggles: 'bottom-panel' },
      { id: 'toggle-right', label: 'Toggle Details', icon: 'sidebar-right', command: 'view.toggleDetails', toggles: 'sidebar:details' },
      { id: 'customize', label: 'Reset Layout', icon: 'layout-grid', command: 'view.resetLayout' },
    ],
    commandCenter: { label: seed.commandLabel, keys: seed.commandKeys },
    editor: {
      contents: [
        { type: 'files', kinds: ['folder', 'file'] },
        { type: 'archive', kinds: ['archive'] },
        { type: 'diff', kinds: ['diff'] },
        { type: 'trash', kinds: ['trash'] },
      ],
      emptyState: {
        icon: 'folder-open',
        title: 'Open a folder to browse it here',
        hint: 'or drag a tab onto this group',
        keys: ['Ctrl', 'O'],
      },
      emptyGroup: (id) => ({ id, path: '', view: 'list', selection: [], tabs: [] }),
      readTab: (raw, tab) => {
        const diff = diffSpec(raw['diff']);
        if ((raw['kind'] === 'diff' && diff === null) || typeof raw['path'] !== 'string') {
          return null;
        }
        return {
          id: tab.id,
          label: tab.label,
          kind: tab.kind as PanelTabState['kind'],
          ...(tab.active === true ? { active: true } : {}),
          path: raw['path'],
          ...(typeof raw['inner'] === 'string' ? { inner: raw['inner'] } : {}),
          ...(diff === null ? {} : { diff }),
        };
      },
      readGroup: (raw, group) => {
        if (typeof raw['path'] !== 'string' || typeof raw['view'] !== 'string' || !VIEWS.has(raw['view'])) {
          return null;
        }
        const sort = raw['sort'] as Record<string, unknown> | undefined;
        const validSort =
          typeof sort === 'object' && sort !== null && typeof sort['key'] === 'string' && SORT_KEYS.has(sort['key']) && (sort['direction'] === 'asc' || sort['direction'] === 'desc')
            ? { sort: { key: sort['key'] as PanelSort['key'], direction: sort['direction'] as PanelSort['direction'] } }
            : {};
        return { ...group, path: raw['path'], view: raw['view'] as UiPanelView, selection: [], ...validSort };
      },
      // What a panel had selected, and where its cursor was, are not kept: they are about what someone was doing.
      writeGroup: (group) => ({
        id: group.id,
        path: group.path,
        view: group.view,
        tabs: group.tabs,
        selection: [],
        ...(group.sort === undefined ? {} : { sort: group.sort }),
      }),
    },
    keybindings: WORKBENCH_DEFAULT_KEYBINDINGS,
    keyCommands: KEY_COMMANDS,
    // The desktop's zoom, answered by the main process's accelerators before the page (PRD 001, §8.2.3).
    fixedKeys: { 'view.zoomIn': 'Ctrl+=', 'view.zoomOut': 'Ctrl+-', 'view.resetZoom': 'Ctrl+0' },
    settingsSections: [
      { id: 'general', label: 'General', icon: 'settings' },
      { id: 'appearance', label: 'Appearance', icon: 'palette' },
    ],
    preferences: PREFERENCES,
    help: HELP,
    tabMenu: ['tab.close', 'tab.closeOthers', 'tab.closeRight', '-', 'file.copyPath', 'file.reveal'],
    // The folders of this computer are not a remote server's (PRD 003, §6).
    sessionScope: scope,
    readSession: (raw) => ({ selectedEntryId: '', showHidden: raw['showHidden'] === true }),
  };
}
