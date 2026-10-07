import { computed, signal } from '@angular/core';
import { UiChromeFeature, type UiActivityItem, type UiCommandTarget, type UiMenuItem, type UiStatusItem } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';
import { isFolder } from '../../file-system/fs-entry-kind';

/** The two sidebars the title bar shows and hides. */
export type SidebarName = 'explorer' | 'details';

/**
 * The window chrome: title bar, activity bar and status bar — the library's
 * `UiChromeFeature`, with what the file manager reports in them.
 *
 * Everything that reports state — problem count, active transfers,
 * selection, hidden-file visibility, the server's clock — is derived from the
 * live workbench, so the bars never claim something that is not true.
 */
export class ChromeFeature extends UiChromeFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  /** Which view the left sidebar shows: the explorer, or the Search view (PRD 003, §5). */
  private readonly sidebar = signal<'explorer' | 'search'>('explorer');

  readonly sidebarView = this.sidebar.asReadonly();

  /** Shows a view of the left sidebar — and the sidebar, if it was hidden, and the file manager it is in (PRD 001, §1.1). */
  showSidebar(view: 'explorer' | 'search'): void {
    this.parent.subAppsFt.show('file-manager');
    this.sidebar.set(view);
    this.revealSidebar('explorer');
  }

  /** The activity bar's Bookmarks (PRD 003, §6): the explorer, with its Bookmarks pane open. */
  showBookmarks(): void {
    this.showSidebar('explorer');
    this.parent.sidebarPanesFt.expand('bookmarks');
    void this.parent.placesFt.load();
  }

  /**
   * Go's choice of computer follows the connection (PRD 008, §1): Local
   * Computer is checked while the workbench talks to its own backend, Remote
   * Computer once it talks to a remote one.
   */
  protected override menuRow(item: UiMenuItem, target: UiCommandTarget): UiMenuItem {
    if (item.id === 'go.local' || item.id === 'go.remote') {
      return { ...item, checked: item.id === (this.parent.backend() === 'local' ? 'go.local' : 'go.remote') };
    }
    return super.menuRow(item, target);
  }

  /**
   * - **Go › Local Computer** (§1.2) — this computer's backend, the default:
   *   disconnects from a remote server, if the window is on one.
   * - **Go › Remote Computer…** (§1.3) — the command palette, straight at
   *   *Connect to Remote Server*.
   * - Everything else is a command of the table, on the active panel.
   */
  protected override runMenuRow(itemId: string): void {
    switch (itemId) {
      case 'go.local':
        void this.parent.connection.disconnect();
        break;
      case 'go.remote':
        this.parent.commandPaletteFt.run('remote.connect');
        break;
      default:
        super.runMenuRow(itemId);
        break;
    }
  }

  /** The sub-applications, the one shown marked (PRD 001, §1.1); then the file manager's own buttons, Transfers counting. */
  override readonly activityItems = computed<readonly UiActivityItem[]>(() => {
    const transfers = this.parent.transfersFt.activeCount();
    const apps = this.parent.subAppsFt;
    return [
      ...apps.apps.map((app): UiActivityItem => ({ id: app.id, label: app.label, icon: app.icon, ...(apps.isActive(app.id) ? { active: true } : {}) })),
      ...(this.parent.config.activityItems ?? []).map((item) => (item.id === 'transfers' && transfers > 0 ? { ...item, badge: transfers } : item)),
    ];
  });

  /**
   * Account and settings. While someone is signed in the account button says
   * who, and is how they sign out (PRD 003, §2); the Settings gear says
   * whether its menu is open.
   */
  override readonly activityBottomItems = computed<readonly UiActivityItem[]>(() => {
    const auth = this.parent.auth;
    const menuOpen = this.settingsMenu() !== null;
    return (this.parent.config.activityBottomItems ?? []).map((item) => {
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
   * The file manager comes back with its Explorer, as the Explorer button
   * did; its name search stays `Ctrl`+`Shift`+`F`.
   */
  override selectActivity(id: string): void {
    if (id === 'file-manager') {
      this.showSidebar('explorer');
      return;
    }
    super.selectActivity(id);
  }

  /**
   * Below the sub-applications, the file manager's: Transfers opens its tab
   * of the bottom panel, Bookmarks the explorer at its Bookmarks pane
   * (PRD 003, §6) — each bringing the file manager forward. The account
   * button signs out.
   */
  protected override runActivity(id: string): void {
    switch (id) {
      case 'transfers':
        this.showBottomTab('transfers');
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

  /** A tab of the bottom panel, chosen by the user — in the file manager, which it is part of (PRD 001, §1.1). */
  private showBottomTab(id: string): void {
    this.parent.subAppsFt.show('file-manager');
    this.parent.bottomPanelFt.select(id);
  }

  override readonly statusLeadingItems = computed<readonly UiStatusItem[]>(() => {
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

  override readonly statusTrailingItems = computed<readonly UiStatusItem[]>(() => {
    const clock = this.parent.serverClockFt;
    const time = clock.label();
    const now = time === null ? [] : [{ id: 'clock', label: time, icon: 'clock' as const, ...(clock.title() === null ? {} : { title: clock.title() as string }) }];
    // Task Manager says how the machine is (PRD 014, §2): it has no folder, selection or order of files to speak of.
    if (this.parent.subAppsFt.isActive('task-manager')) {
      return [...this.parent.taskManagerFt.statusItems(), ...now];
    }
    return [
      { id: 'selection', label: this.selectionSummary() },
      {
        id: 'hidden',
        label: `Hidden files: ${this.parent.showHidden() ? 'shown' : 'hidden'}`,
        title: 'Toggle hidden files',
      },
      { id: 'sort', label: this.sortSummary(), title: 'Turn the order round' },
      // The server's date and time, last, at the far right (PRD 001, §13.1) — once it has said.
      ...now,
    ];
  });

  /** `Sorted by Size, descending` — the active panel's order (PRD 003, §5). */
  private readonly sortSummary = computed(() => {
    const sort = this.parent.fileBrowserFt.sortOf(this.parent.activeGroupId());
    const column = { name: 'Name', size: 'Size', type: 'Type', modified: 'Date Modified' }[sort.key];
    return `Sorted by ${column}${sort.direction === 'desc' ? ', descending' : ''}`;
  });

  /** Status-bar items that do something when clicked. */
  override runStatusAction(id: string): void {
    switch (id) {
      case 'hidden':
        this.parent.showHidden.update((shown) => !shown);
        break;
      case 'problems':
        this.showBottomTab('problems');
        break;
      case 'transfers':
        this.showBottomTab('transfers');
        break;
      case 'sort':
        this.parent.commandsFt.run('view.sortDescending');
        break;
      case 'tm-pause':
        this.parent.taskManagerFt.togglePause();
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
