import { computed } from '@angular/core';
import type { UiActivityItem, UiIconAction, UiMenuBarItem, UiStatusItem } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * The window chrome: title bar, activity bar and status bar.
 *
 * The menus are still static configuration, but everything that reports state —
 * problem count, active transfers, selection, hidden-file visibility — is derived
 * from the live workbench, so the bars never claim something that is not true.
 */
export class ChromeFeature {
  readonly menuItems: readonly UiMenuBarItem[];
  readonly commandLabel: string;
  readonly commandKeys: readonly string[];
  readonly titleBarActions: readonly UiIconAction[];
  readonly activityBottomItems: readonly UiActivityItem[];
  readonly sidebarMoreActions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    const mock = parent.mockWorkbench;
    this.menuItems = mock.menuItems;
    this.commandLabel = mock.commandLabel;
    this.commandKeys = mock.commandKeys;
    this.titleBarActions = mock.titleBarActions;
    this.activityBottomItems = mock.activityBottomItems;
    this.sidebarMoreActions = mock.sidebarMoreActions;
  }

  readonly activityItems = computed<readonly UiActivityItem[]>(() => {
    const transfers = this.parent.transfersFt.activeCount();
    return [
      { id: 'explorer', label: 'Explorer', icon: 'copy', active: true },
      { id: 'search', label: 'Search', icon: 'search' },
      {
        id: 'transfers',
        label: 'Transfers',
        icon: 'download',
        ...(transfers > 0 ? { badge: transfers } : {}),
      },
      { id: 'bookmarks', label: 'Bookmarks', icon: 'star' },
    ];
  });

  readonly statusLeadingItems = computed<readonly UiStatusItem[]>(() => {
    const problems = this.parent.fsDataFt.errors().length;
    const transfers = this.parent.transfersFt.activeCount();
    const items: UiStatusItem[] = [
      {
        id: 'root',
        label: this.parent.mockWorkbench.workspaceName,
        icon: 'desktop',
        accent: true,
        title: 'Workspace served by the backend',
      },
      {
        id: 'problems',
        label: problems === 0 ? 'No problems' : `${problems} ${problems === 1 ? 'problem' : 'problems'}`,
        icon: problems === 0 ? 'check' : 'alert-triangle',
        title: 'Show the Problems panel',
      },
    ];

    if (transfers > 0) {
      items.push({
        id: 'transfers',
        label: `${transfers} transferring`,
        icon: 'sync',
        title: 'Show the Transfers panel',
      });
    }

    return items;
  });

  readonly statusTrailingItems = computed<readonly UiStatusItem[]>(() => [
    { id: 'selection', label: this.selectionSummary() },
    {
      id: 'hidden',
      label: `Hidden files: ${this.parent.showHidden() ? 'shown' : 'hidden'}`,
      title: 'Toggle hidden files',
    },
    { id: 'sort', label: 'Sorted by Name' },
  ]);

  /** Status-bar items that do something when clicked. */
  runStatusAction(id: string): void {
    switch (id) {
      case 'hidden':
        this.parent.showHidden.update((shown) => !shown);
        break;
      case 'problems':
        this.parent.bottomPanelFt.select('problems');
        break;
      case 'transfers':
        this.parent.bottomPanelFt.select('transfers');
        break;
      default:
        break;
    }
  }

  /** e.g. `'1 of 12 selected · 6.4 MB'`, from the active group's listing. */
  private readonly selectionSummary = computed(() => {
    const groupPath = this.parent.editorGroupsFt.pathOf(this.parent.activeGroupId());
    if (groupPath === undefined) {
      return 'No folder open';
    }

    const entries = this.parent.fsDataFt.entries(groupPath);
    const selectedId = this.parent.selectedEntryId();
    const selected = entries.filter((entry) => entry.path === selectedId);
    if (selected.length === 0) {
      return `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`;
    }

    const bytes = selected.reduce((total, entry) => total + entry.size, 0);
    return `${selected.length} of ${entries.length} selected · ${this.parent.fileViewModel.formatBytes(bytes)}`;
  });
}
