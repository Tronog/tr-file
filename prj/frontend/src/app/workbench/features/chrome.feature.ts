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

/** The two sidebars the title bar shows and hides. */
export type SidebarName = 'explorer' | 'details';

/** What each title-bar button runs: commands of the table, so the palette and the View menu run the same. */
const TITLE_BAR_COMMANDS: Readonly<Record<string, string>> = {
  'toggle-theme': 'view.toggleTheme',
  'toggle-left': 'view.toggleExplorer',
  'toggle-panel': 'view.togglePanel',
  'toggle-right': 'view.toggleDetails',
  customize: 'view.resetLayout',
};

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
  readonly sidebarMoreActions: readonly UiIconAction[];

  /** Whether the Explorer and Details sidebars are shown — the title bar's two sidebar buttons. */
  private readonly shown = signal<Readonly<Record<SidebarName, boolean>>>({ explorer: true, details: true });

  constructor(private readonly parent: WorkbenchService) {
    const mock = parent.mockWorkbench;
    this.commandLabel = mock.commandLabel;
    this.commandKeys = mock.commandKeys;
    this.sidebarMoreActions = mock.sidebarMoreActions;
  }

  /**
   * The title bar's layout buttons (PRD 001, §15.1): the Explorer, the bottom
   * panel and Details — each pressed while what it toggles is showing, and a
   * sidebar's drawn on the side the settings put it (PRD 010, §3) — then
   * *Reset Layout*.
   */
  readonly titleBarActions = computed<readonly UiIconAction[]>(() => {
    const preferences = this.parent.preferencesFt;
    const icon = (side: 'left' | 'right'): UiIconAction['icon'] => (side === 'left' ? 'sidebar-left' : 'sidebar-right');
    return this.parent.mockWorkbench.titleBarActions.map((action): UiIconAction => {
      switch (action.id) {
        case 'toggle-left':
          return { ...action, icon: icon(preferences.explorerSide()), active: this.isShown('explorer') };
        case 'toggle-right':
          return { ...action, icon: icon(preferences.detailsSide()), active: this.isShown('details') };
        case 'toggle-panel':
          return { ...action, active: !this.parent.bottomPanelFt.collapsed() };
        // Leftmost of the group (PRD 001, §8.2.2): the sun in the dark, the moon in the light — what a press turns to.
        case 'toggle-theme':
          return preferences.effectiveTheme() === 'dark'
            ? { ...action, label: 'Switch to Light Theme', icon: 'sun' }
            : { ...action, label: 'Switch to Dark Theme', icon: 'moon' };
        default:
          return action;
      }
    });
  });

  isShown(sidebar: SidebarName): boolean {
    return this.shown()[sidebar];
  }

  /**
   * Hides or shows a sidebar. Hidden with the keyboard in it, the keyboard
   * goes to the active panel's content, as it does when the bottom panel is
   * put away (PRD 001, §12.3) — else it would be left on nothing.
   */
  toggleSidebar(sidebar: SidebarName): void {
    const hiding = this.isShown(sidebar);
    const hadFocus = hiding && ChromeFeature.focusIsIn(sidebar);
    this.shown.update((shown) => ({ ...shown, [sidebar]: !hiding }));
    if (hadFocus) {
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }

  /** Puts the sidebars back as a restored session had them. */
  restoreSidebars(hidden: readonly SidebarName[]): void {
    this.shown.set({ explorer: !hidden.includes('explorer'), details: !hidden.includes('details') });
  }

  /** The hidden sidebars, for the session. */
  hiddenSidebars(): readonly SidebarName[] {
    return (['explorer', 'details'] as const).filter((sidebar) => !this.isShown(sidebar));
  }

  private static focusIsIn(region: SidebarName): boolean {
    const focused = globalThis.document?.activeElement;
    return focused instanceof Element && focused.closest(`[data-focus-region="${region}"]`) !== null;
  }

  /** The main menu that is open, if any (PRD 008, §1). */
  private readonly openMenuId = signal<string | null>(null);

  /** Which view the left sidebar shows: the explorer, or the Search view (PRD 003, §5). */
  private readonly sidebar = signal<'explorer' | 'search'>('explorer');

  readonly sidebarView = this.sidebar.asReadonly();

  /** Shows a view of the left sidebar — and the sidebar, if it was hidden. */
  showSidebar(view: 'explorer' | 'search'): void {
    this.sidebar.set(view);
    if (!this.isShown('explorer')) {
      this.shown.update((shown) => ({ ...shown, explorer: true }));
    }
  }

  /** The activity bar's Bookmarks (PRD 003, §6): the explorer, with its Bookmarks pane open. */
  showBookmarks(): void {
    this.showSidebar('explorer');
    this.parent.sidebarPanesFt.expand('bookmarks');
    void this.parent.placesFt.load();
  }

  /**
   * What the Settings menu offers (PRD 007, §1; PRD 003, §6): commands of the
   * table, laid out in `MockDataWorkbenchService.settingsMenuItems` — checked
   * and enabled as they stand.
   */
  readonly settingsMenuItems = computed<readonly UiMenuItem[]>(() => {
    const commands = this.parent.commandsFt;
    // The menu's own words — *Settings*, not the palette's *Open Settings* — with the command's state.
    return this.parent.mockWorkbench.settingsMenuItems.map((item) =>
      commands.command(item.id) === undefined ? item : { ...commands.menuItem(item.id, commands.activeTarget(), !!item.separatorBefore), label: item.label },
    );
  });

  /**
   * The main menu, with the open one marked. Each row is a command of the
   * table (`CommandsFeature`), labelled, enabled and checked as it stands for
   * the active panel — so File › Rename… greys out with nothing selected, and
   * View shows the panel's own view and sort. Go's choice of computer follows
   * the connection: Local Computer is checked while the workbench talks to its
   * own backend, Remote Computer once it talks to a remote one.
   */
  readonly menuItems = computed<readonly UiMenuBarItem[]>(() => {
    const open = this.openMenuId();
    const backend = this.parent.backend();
    const commands = this.parent.commandsFt;
    const target = commands.activeTarget();
    return this.parent.mockWorkbench.menuItems.map((menu) => ({
      ...menu,
      open: menu.id === open,
      items: (menu.items ?? []).map((item) => {
        if (item.id === 'go.local' || item.id === 'go.remote') {
          return { ...item, checked: item.id === (backend === 'local' ? 'go.local' : 'go.remote') };
        }
        return commands.command(item.id) === undefined ? item : commands.menuItem(item.id, target, !!item.separatorBefore);
      }),
    }));
  });

  /** `F9` (PRD 004, §2): the first menu opens, as Midnight Commander's pull-down does. */
  openMainMenu(): void {
    this.openMenuId.set(this.parent.mockWorkbench.menuItems[0]?.id ?? null);
  }

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
   * - **File › Copy To… / Move To… / Move to Trash / Empty Trash…** — the
   *   file operations of PRD 005, §1, on the active panel's selection.
   * - **Edit › Cut / Copy / Paste** — the file clipboard (§2), on the active panel.
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
        // Everything else is a command of the table, run on the active panel.
        this.parent.commandsFt.run(selection.itemId);
        break;
    }
  }

  /** Where the Settings menu is open — its bottom-left corner — or `null` (PRD 007, §1). */
  private readonly settingsMenuAt = signal<{ readonly x: number; readonly y: number; readonly leftward?: boolean } | null>(null);

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
    if (this.settingsMenuAt() !== null) {
      this.settingsMenuAt.set(null);
      return;
    }
    // With the activity bar on the right (PRD 010, §3) the menu opens leftward, from the gear's left edge.
    this.settingsMenuAt.set(
      this.parent.preferencesFt.explorerSide() === 'right' ? { x: anchor.left, y: anchor.bottom, leftward: true } : { x: anchor.right, y: anchor.bottom },
    );
  }

  closeSettingsMenu(): void {
    this.settingsMenuAt.set(null);
  }

  /** A Settings menu entry was chosen. None does anything yet; the menu just closes. */
  runSettingsItem(id: string): void {
    this.closeSettingsMenu();
    this.parent.commandsFt.run(id);
  }

  /**
   * A click in the activity bar: Explorer and Search switch the left sidebar
   * (PRD 003, §5), Transfers opens its tab of the bottom panel, and the
   * account button signs out. Bookmarks opens the explorer at its Bookmarks
   * pane (PRD 003, §6).
   */
  selectActivity(id: string): void {
    switch (id) {
      case 'explorer':
        this.showSidebar('explorer');
        break;
      case 'search':
        this.parent.searchFt.show();
        break;
      case 'transfers':
        this.parent.bottomPanelFt.select('transfers');
        break;
      case 'bookmarks':
        this.showBookmarks();
        break;
      case 'account':
        if (this.parent.auth.canSignOut()) {
          void this.parent.auth.signOut();
        }
        break;
      default:
        break;
    }
  }

  readonly activityItems = computed<readonly UiActivityItem[]>(() => {
    const transfers = this.parent.transfersFt.activeCount();
    const view = this.sidebar();
    return [
      { id: 'explorer', label: 'Explorer', icon: 'copy', ...(view === 'explorer' ? { active: true } : {}) },
      { id: 'search', label: 'Search (Ctrl+Shift+F)', icon: 'search', ...(view === 'search' ? { active: true } : {}) },
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
            label: this.parent.workspaceName(),
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

  readonly statusTrailingItems = computed<readonly UiStatusItem[]>(() => {
    const clock = this.parent.serverClockFt;
    const time = clock.label();
    return [
      { id: 'selection', label: this.selectionSummary() },
      {
        id: 'hidden',
        label: `Hidden files: ${this.parent.showHidden() ? 'shown' : 'hidden'}`,
        title: 'Toggle hidden files',
      },
      { id: 'sort', label: this.sortSummary(), title: 'Turn the order round' },
      // The server's date and time, last, at the far right (PRD 001, §13.1) — once it has said.
      ...(time === null ? [] : [{ id: 'clock', label: time, icon: 'clock' as const, ...(clock.title() === null ? {} : { title: clock.title() as string }) }]),
    ];
  });

  /** `Sorted by Size, descending` — the active panel's order (PRD 003, §5). */
  private readonly sortSummary = computed(() => {
    const sort = this.parent.fileBrowserFt.sortOf(this.parent.activeGroupId());
    const column = { name: 'Name', size: 'Size', type: 'Type', modified: 'Date Modified' }[sort.key];
    return `Sorted by ${column}${sort.direction === 'desc' ? ', descending' : ''}`;
  });

  /** Status-bar items that do something when clicked. */
  /**
   * A title-bar button (PRD 001, §15.1): the sidebars and the bottom panel
   * (§12.3) are shown and hidden; the last one resets the layout, once the
   * user has said so.
   */
  runTitleBarAction(id: string): void {
    const command = TITLE_BAR_COMMANDS[id];
    if (command !== undefined) {
      this.parent.commandsFt.run(command);
    }
  }

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
      case 'sort':
        this.parent.commandsFt.run('view.sortDescending');
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
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(this.parent.activeGroupId());
    if (group === undefined) {
      return 'No folder open';
    }
    // The trash counts what is in it (PRD 001, §14.1), not the root it shares a path with.
    if (groups.activeTabOf(group)?.kind === 'trash') {
      return this.parent.trashFt.summary();
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
