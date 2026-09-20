import { Service } from '@angular/core';
import type { UiActivityItem, UiIconAction, UiMenuBarItem, UiPanelTab, UiStatusItem } from '@tr-file/ui';
import type { MockWorkbenchLayout } from './mock-data.model';

/**
 * The mocked workbench state: which panels are open, how they are split, and
 * what the surrounding chrome shows.
 *
 * In the real app this is the restored workspace a user left behind, plus a few
 * pieces of static configuration. Everything here is data — the transformations
 * into view models live in the feature classes.
 */
@Service()
export class MockDataWorkbenchService {
  /**
   * Layout at start-up: one group on the left, a column of two groups on the
   * right. Mirrors `mockup/001/index.html`.
   */
  readonly layout: MockWorkbenchLayout = {
    grid: {
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'leaf', groupId: 'group-prj', size: 1 },
        {
          kind: 'split',
          direction: 'column',
          size: 1,
          children: [
            { kind: 'leaf', groupId: 'group-docs', size: 1 },
            { kind: 'leaf', groupId: 'group-assets', size: 1 },
          ],
        },
      ],
    },
    groups: [
      {
        id: 'group-prj',
        path: 'prj',
        view: 'list',
        selection: ['prj/frontend', 'prj/libs'],
        focusedEntryId: 'prj/frontend',
        columns: ['size', 'type', 'modified'],
        toolbar: {
          actions: [
            { id: 'up', label: 'Up one level', icon: 'arrow-up' },
            { id: 'refresh', label: 'Refresh listing', icon: 'refresh' },
            { id: 'sort', label: 'Sort', icon: 'sort' },
            { id: 'filter', label: 'Filter', icon: 'filter' },
          ],
          viewSwitch: true,
          search: true,
        },
        tabs: [
          { id: 'tab-prj', label: 'prj', path: 'prj', active: true },
          { id: 'tab-frontend', label: 'frontend', path: 'prj/frontend' },
          { id: 'tab-search', label: 'Results: *.ts', path: null, preview: true, icon: 'search' },
        ],
      },
      {
        id: 'group-docs',
        path: 'docs/ai',
        view: 'list',
        selection: ['docs/ai/VSCODE-UI.md'],
        columns: ['size', 'modified'],
        toolbar: { actions: [], viewSwitch: false, search: false },
        tabs: [
          { id: 'tab-ai', label: 'ai', path: 'docs/ai', active: true },
          { id: 'tab-prd-001', label: '001.md', path: null, dirty: true, icon: 'file' },
        ],
      },
      {
        id: 'group-assets',
        path: 'assets',
        view: 'grid',
        selection: ['assets/logo.svg'],
        columns: ['size', 'modified'],
        toolbar: {
          actions: [{ id: 'sort', label: 'Sort', icon: 'sort' }],
          viewSwitch: true,
          search: false,
        },
        tabs: [{ id: 'tab-assets', label: 'assets', path: 'assets', active: true }],
      },
    ],
    expandedPaths: ['prj', 'prj/frontend', 'docs', 'docs/prd'],
    selectedEntryId: 'docs/prd/001.md',
    activeGroupId: 'group-prj',
    leftSidebarWidth: 280,
    rightSidebarWidth: 320,
    bottomPanelHeight: 200,
  };

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

  readonly commandLabel = 'Go to file or folder…';
  readonly commandKeys: readonly string[] = ['Ctrl', 'P'];

  readonly titleBarActions: readonly UiIconAction[] = [
    { id: 'toggle-left', label: 'Toggle left sidebar', icon: 'sidebar-left', active: true },
    { id: 'toggle-panel', label: 'Toggle bottom panel', icon: 'panel-bottom', active: true },
    { id: 'toggle-right', label: 'Toggle right sidebar', icon: 'sidebar-right', active: true },
    { id: 'customize', label: 'Customize layout', icon: 'layout-grid' },
  ];

  readonly activityItems: readonly UiActivityItem[] = [
    { id: 'explorer', label: 'Explorer', icon: 'copy', active: true },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'transfers', label: 'Transfers', icon: 'download', badge: 3 },
    { id: 'remotes', label: 'Remotes', icon: 'cloud' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'star' },
  ];

  readonly activityBottomItems: readonly UiActivityItem[] = [
    { id: 'account', label: 'Account', icon: 'user' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  readonly sidebarMoreActions: readonly UiIconAction[] = [
    { id: 'more', label: 'More actions', icon: 'dots' },
  ];

  readonly explorerActions: readonly UiIconAction[] = [
    { id: 'new-file', label: 'New file', icon: 'file-plus' },
    { id: 'new-folder', label: 'New folder', icon: 'folder-plus' },
    { id: 'refresh', label: 'Refresh explorer', icon: 'refresh' },
    { id: 'collapse', label: 'Collapse all', icon: 'chevrons-up' },
  ];

  /* -- bottom panel ------------------------------------------------------ */

  readonly panelTabs: readonly UiPanelTab[] = [
    { id: 'problems', label: 'Problems', count: 2 },
    { id: 'output', label: 'Output' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'transfers', label: 'Transfers', count: 3, active: true },
  ];

  readonly panelActions: readonly UiIconAction[] = [
    { id: 'clear', label: 'Clear panel', icon: 'trash' },
    { id: 'maximize', label: 'Maximize panel', icon: 'chevrons-up' },
    { id: 'close', label: 'Close panel', icon: 'x' },
  ];

  /* -- status bar -------------------------------------------------------- */

  readonly statusLeadingItems: readonly UiStatusItem[] = [
    { id: 'remote', label: 'SSH: build-01', icon: 'cloud', accent: true, title: 'Connected to build-01' },
    { id: 'branch', label: 'main*', icon: 'git-branch', title: 'Current branch' },
    { id: 'sync', label: '2↓ 1↑', icon: 'sync', title: 'Incoming and outgoing changes' },
    { id: 'problems', label: '0 errors, 2 warnings', icon: 'alert-triangle', title: 'Problems' },
    { id: 'transfers', label: '3 transfers · 1.4 MB/s', icon: 'download', title: 'Active transfers' },
  ];

  readonly statusTrailingItems: readonly UiStatusItem[] = [
    { id: 'sort', label: 'Sorted by Name' },
    { id: 'hidden', label: 'Show hidden: off' },
    { id: 'encoding', label: 'UTF-8' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
  ];
}
