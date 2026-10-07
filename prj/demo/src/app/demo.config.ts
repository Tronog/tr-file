import {
  uiColorThemePreference,
  uiResetLayoutPreference,
  uiRestoreLayoutPreference,
  uiSidebarLocationPreference,
  type UiSidebarDef,
  type UiWorkbenchConfig,
} from '@tr-file/ui';
import type { NoteGroup, NoteTab } from './notes.model';

const EXPLORER: UiSidebarDef = {
  id: 'explorer',
  label: 'Explorer',
  side: 'left',
  toggleCommand: 'view.toggleExplorer',
  locationSetting: 'workbench.explorerLocation',
  panes: [
    { id: 'notes', label: 'Notes', expanded: true },
    { id: 'outline', label: 'Outline', expanded: true },
  ],
};

const DETAILS: UiSidebarDef = {
  id: 'details',
  label: 'Details',
  side: 'right',
  toggleCommand: 'view.toggleDetails',
  locationSetting: 'workbench.detailsLocation',
  panes: [
    { id: 'info', label: 'Info', expanded: true },
    { id: 'help', label: 'Getting Around', expanded: true, hidden: true },
  ],
};

/**
 * The demo's workbench, as data: a notes app with two sub-applications, a
 * sidebar of notes and one about the note open, panels of notes, a bottom
 * panel, menus, keys, settings and a cheatsheet — everything the library
 * draws and runs, none of it a file manager's.
 */
export const DEMO_CONFIG: UiWorkbenchConfig<NoteTab, NoteGroup> = {
  title: 'Workbench demo',
  icon: 'file-text',
  layout: {
    grid: { kind: 'leaf', groupId: 'group-1', size: 1 },
    groups: [{ id: 'group-1', tabs: [{ id: 'tab-welcome', kind: 'welcome', label: 'Welcome', active: true }] }],
    activeGroupId: 'group-1',
    leftSidebarWidth: 260,
    rightSidebarWidth: 280,
    bottomPanelHeight: 180,
  },
  subApps: [
    { id: 'notes', label: 'Notes', icon: 'file-text', main: true },
    { id: 'about', label: 'About', icon: 'info' },
  ],
  sidebars: [EXPLORER, DETAILS],
  bottomPanel: {
    label: 'Panel',
    tabs: [
      { id: 'output', label: 'Output' },
      { id: 'scratch', label: 'Scratch' },
    ],
    defaultTab: 'output',
  },
  menus: [
    {
      id: 'file',
      label: 'File',
      items: [
        { id: 'notes.new', label: 'New Note' },
        { id: 'notes.delete', label: 'Delete Note…', separatorBefore: true },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { id: 'view.app.notes', label: 'Show Notes' },
        { id: 'view.app.about', label: 'Show About' },
        { id: 'view.toggleExplorer', label: 'Toggle Explorer', separatorBefore: true },
        { id: 'view.toggleDetails', label: 'Toggle Details' },
        { id: 'view.toggleSidebars', label: 'Toggle Explorer and Details' },
        { id: 'view.togglePanel', label: 'Toggle Panel' },
        { id: 'view.toggleTheme', label: 'Toggle Theme', separatorBefore: true },
        { id: 'view.resetLayout', label: 'Reset Layout' },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { id: 'help.show', label: 'Show Help' },
        { id: 'help.cheatsheet', label: 'Keyboard Shortcuts Cheatsheet' },
      ],
    },
  ],
  settingsMenu: [
    { id: 'workbench.openSettings', label: 'Settings' },
    { id: 'workbench.openKeybindings', label: 'Keyboard Shortcuts' },
    { id: 'settings.restoreSession', label: 'Restore Layout on Start', separatorBefore: true },
    { id: 'view.resetLayout', label: 'Reset Layout' },
  ],
  activityItems: [{ id: 'notes.new', label: 'New Note', icon: 'plus', separatorBefore: true }],
  activityBottomItems: [{ id: 'settings', label: 'Settings', icon: 'settings', hasMenu: true }],
  titleBarActions: [
    { id: 'theme', label: 'Switch Theme', icon: 'sun', command: 'view.toggleTheme', toggles: 'theme' },
    { id: 'left', label: 'Toggle Explorer', icon: 'sidebar-left', command: 'view.toggleExplorer', toggles: 'sidebar:explorer' },
    { id: 'panel', label: 'Toggle Panel', icon: 'panel-bottom', command: 'view.togglePanel', toggles: 'bottom-panel' },
    { id: 'right', label: 'Toggle Details', icon: 'sidebar-right', command: 'view.toggleDetails', toggles: 'sidebar:details' },
    { id: 'reset', label: 'Reset Layout', icon: 'layout-grid', command: 'view.resetLayout' },
  ],
  commandCenter: { label: 'Search commands…', keys: ['Ctrl', 'Shift', 'P'] },
  editor: {
    contents: [
      { type: 'note', kinds: ['note'], icon: 'file-text' },
      { type: 'welcome', kinds: ['welcome'], icon: 'info' },
    ],
    emptyState: { icon: 'file-text', title: 'No note open', hint: 'Open one from the Explorer, or make a new one', keys: ['Alt', 'N'] },
    emptyGroup: (id) => ({ id, tabs: [] }),
    // A note's tab names its note; a welcome tab names nothing.
    readTab: (raw, tab) =>
      tab.kind === 'note'
        ? typeof raw['noteId'] === 'string'
          ? { ...tab, kind: 'note', noteId: raw['noteId'] }
          : null
        : { ...tab, kind: 'welcome' },
  },
  keybindings: [
    { command: 'view.commandPalette', key: 'Ctrl+Shift+P', when: 'window' },
    { command: 'view.commandPalette', key: 'Ctrl+P', when: 'window' },
    { command: 'workbench.openSettings', key: 'Ctrl+,', when: 'window' },
    { command: 'view.togglePanel', key: 'Ctrl+J', when: 'window' },
    { command: 'view.toggleExplorer', key: 'Ctrl+B', when: 'window' },
    { command: 'view.toggleDetails', key: 'Ctrl+Alt+B', when: 'window' },
    { command: 'notes.new', key: 'Alt+N', when: 'window' },
    { command: 'workbench.focusNextPart', key: 'Ctrl+Tab', when: 'window' },
    { command: 'workbench.focusPreviousPart', key: 'Ctrl+Shift+Tab', when: 'window' },
    { command: 'workbench.nextPanel', key: 'Tab', when: 'panel' },
    { command: 'workbench.previousPanel', key: 'Shift+Tab', when: 'panel' },
    { command: 'help.show', key: 'F1', when: 'window' },
    { command: 'view.mainMenu', key: 'F10', when: 'window' },
  ],
  preferences: [
    uiRestoreLayoutPreference(),
    uiResetLayoutPreference(),
    {
      id: 'notes.confirmDelete',
      section: 'general',
      group: 'Notes',
      category: 'Notes',
      title: 'Confirm Delete',
      description: 'Ask before a note is deleted.',
      kind: { type: 'boolean', default: true },
    },
    uiColorThemePreference(),
    uiSidebarLocationPreference(EXPLORER, 'Which side of the window the Explorer is on, with the activity bar beside it.'),
    uiSidebarLocationPreference(DETAILS, 'Which side of the window the Details sidebar is on.'),
  ],
  help: {
    subjects: [
      { id: 'window', title: 'Window', hue: 'blue', commands: ['view.commandPalette', 'workbench.openSettings', 'view.togglePanel', 'view.toggleExplorer', 'view.toggleDetails', 'help.show', 'view.mainMenu'] },
      { id: 'panels', title: 'Panels and tabs', hue: 'purple', commands: ['workbench.focusNextPart', 'workbench.nextPanel', 'view.splitRight', 'tab.new', 'tab.close', 'tab.previous', 'tab.next', 'view.toggleMaximize'] },
      { id: 'notes', title: 'Notes', hue: 'green', commands: ['notes.new'] },
    ],
  },
};
