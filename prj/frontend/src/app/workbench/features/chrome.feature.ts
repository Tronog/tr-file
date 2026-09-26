import { computed, signal } from '@angular/core';
import type {
  UiActivityItem,
  UiIconAction,
  UiMenuAnchor,
  UiMenuBarItem,
  UiMenuBarSelection,
  UiMenuItem,
  UiStatusItem,
} from '@tr-file/ui';
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
  readonly commandLabel: string;
  readonly commandKeys: readonly string[];
  readonly titleBarActions: readonly UiIconAction[];
  readonly sidebarMoreActions: readonly UiIconAction[];
  /** What the Settings menu offers (PRD 007, §1). */
  readonly settingsMenuItems: readonly UiMenuItem[];

  constructor(private readonly parent: WorkbenchService) {
    const mock = parent.mockWorkbench;
    this.commandLabel = mock.commandLabel;
    this.commandKeys = mock.commandKeys;
    this.titleBarActions = mock.titleBarActions;
    this.sidebarMoreActions = mock.sidebarMoreActions;
    this.settingsMenuItems = mock.settingsMenuItems;
  }

  /** The main menu that is open, if any (PRD 008, §1). */
  private readonly openMenuId = signal<string | null>(null);

  /**
   * The main menu, with the open one marked and Go's choice of computer
   * following the connection: Local Computer is checked while the workbench
   * talks to its own backend, Remote Computer once it talks to a remote one.
   */
  readonly menuItems = computed<readonly UiMenuBarItem[]>(() => {
    const open = this.openMenuId();
    const backend = this.parent.backend();
    return this.parent.mockWorkbench.menuItems.map((menu) => ({
      ...menu,
      open: menu.id === open,
      ...(menu.id === 'go'
        ? {
            items: (menu.items ?? []).map((item) =>
              item.id === 'go.local' || item.id === 'go.remote'
                ? { ...item, checked: item.id === (backend === 'local' ? 'go.local' : 'go.remote') }
                : item,
            ),
          }
        : {}),
    }));
  });

  /** Opens the main menu `id`, or closes the open one with `null`. */
  setMenuOpen(id: string | null): void {
    this.openMenuId.set(id);
  }

  /**
   * An entry of the main menu was chosen; the menu closes either way.
   *
   * - **Go › Local Computer** (§1.2) — this computer's backend, the default:
   *   disconnects from a remote server, if the window is on one.
   * - **Go › Remote Computer…** (§1.3) — the command palette, straight at
   *   *Connect to Remote Server*.
   */
  runMenuItem(selection: UiMenuBarSelection): void {
    this.openMenuId.set(null);
    switch (selection.itemId) {
      case 'go.local':
        void this.parent.connection.disconnect();
        break;
      case 'go.remote':
        this.parent.commandPaletteFt.run('remote.connect');
        break;
      default:
        break;
    }
  }

  /** Where the Settings menu is open — its bottom-left corner — or `null` (PRD 007, §1). */
  private readonly settingsMenuAt = signal<{ readonly x: number; readonly y: number } | null>(null);

  readonly settingsMenu = this.settingsMenuAt.asReadonly();


  /**
   * Account and settings. While someone is signed in the account button says
   * who, and is how they sign out (PRD 003, §2); the Settings gear says
   * whether its menu is open.
   */
  readonly activityBottomItems = computed<readonly UiActivityItem[]>(() => {
    const auth = this.parent.auth;
    const menuOpen = this.settingsMenuAt() !== null;
    return this.parent.mockWorkbench.activityBottomItems.map((item) => {
      if (item.id === 'account' && auth.canSignOut()) {
        return { ...item, label: `Sign out ${auth.username() ?? ''}`.trim() };
      }
      if (item.id === 'settings') {
        return { ...item, expanded: menuOpen, active: menuOpen };
      }
      return item;
    });
  });

  /**
   * A menu button in the activity bar was pressed. The Settings gear opens its
   * menu beside it, growing upward from the gear's bottom edge the way VS
   * Code's Manage menu does — or closes it, when it is already open.
   */
  openMenu(anchor: UiMenuAnchor): void {
    if (anchor.id !== 'settings') {
      return;
    }
    this.settingsMenuAt.set(this.settingsMenuAt() === null ? { x: anchor.right, y: anchor.bottom } : null);
  }

  closeSettingsMenu(): void {
    this.settingsMenuAt.set(null);
  }

  /** A Settings menu entry was chosen. None does anything yet; the menu just closes. */
  runSettingsItem(_id: string): void {
    this.closeSettingsMenu();
  }

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
      // VS Code's remote indicator: which computer the files are on (PRD 006, §1).
      this.parent.connection.connected()
        ? {
            id: 'root',
            label: this.parent.connection.label() ?? 'Remote',
            icon: 'cloud',
            accent: true,
            title: 'Connected to a remote server — Go › Local Computer to disconnect',
          }
        : {
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
