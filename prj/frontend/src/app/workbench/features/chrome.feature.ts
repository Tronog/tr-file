import { computed } from '@angular/core';
import type { UiActivityItem, UiIconAction, UiMenuBarItem, UiStatusItem } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';
import { isFolder } from '../../file-system/fs-entry-kind';

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
  readonly sidebarMoreActions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    const mock = parent.mockWorkbench;
    this.menuItems = mock.menuItems;
    this.commandLabel = mock.commandLabel;
    this.commandKeys = mock.commandKeys;
    this.titleBarActions = mock.titleBarActions;
    this.sidebarMoreActions = mock.sidebarMoreActions;
  }

  /**
   * Account and settings. While someone is signed in the account button says
   * who, and is how they sign out (PRD 003, §2).
   */
  readonly activityBottomItems = computed<readonly UiActivityItem[]>(() => {
    const auth = this.parent.auth;
    return this.parent.mockWorkbench.activityBottomItems.map((item) =>
      item.id === 'account' && auth.canSignOut()
        ? { ...item, label: `Sign out ${auth.username() ?? ''}`.trim() }
        : item,
    );
  });

  /** A click in the activity bar. Only the account button acts yet (the rest is PRD 003, §3). */
  selectActivity(id: string): void {
    if (id === 'account' && this.parent.auth.canSignOut()) {
      void this.parent.auth.signOut();
    }
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

  /**
   * e.g. `'3 of 12 selected · 6.4 MB'`, from the active group's listing and
   * selection — which may be many entries (PRD 004, §1.2), some of them inside
   * folders opened in the tree view.
   */
  private readonly selectionSummary = computed(() => {
    const group = this.parent.editorGroupsFt.stateOf(this.parent.activeGroupId());
    if (group === undefined) {
      return 'No folder open';
    }

    const data = this.parent.fsDataFt;
    const entries = data.entries(group.path);
    const selected = group.selection
      .map((path) => data.entryAt(path))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (selected.length === 0) {
      return `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`;
    }

    // Folders report no size of their own, so they add nothing to the total.
    const bytes = selected.reduce((total, entry) => total + (isFolder(entry) ? 0 : entry.size), 0);
    return `${selected.length} of ${entries.length} selected · ${this.parent.fileViewModel.formatBytes(bytes)}`;
  });
}
