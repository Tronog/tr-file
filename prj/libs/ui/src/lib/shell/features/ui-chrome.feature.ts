import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiActivityItem, UiMenuAnchor, UiMenuBarItem, UiMenuBarSelection, UiMenuItem, UiStatusItem } from '../../models/chrome.model';
import type { UiIconAction } from '../../models/icon.model';
import type { UiCommandTarget } from '../ui-commands.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

/**
 * The window chrome: the title bar with its menus and buttons, the activity
 * bar with the Settings gear's menu, the status bar — and which sidebars are
 * shown.
 *
 * Menus are rows of commands by id (`UiWorkbenchConfig.menus`), labelled,
 * enabled and checked as the command table says for the active panel, so a
 * menu never offers what the palette and the keys would not. Whatever
 * reports state — a badge, a status item — is the application's, by
 * overriding the computed that draws it.
 */
export class UiChromeFeature {
  readonly commandLabel: string;
  readonly commandKeys: readonly string[];
  readonly sidebarMoreActions: readonly UiIconAction[];

  /** Whether each sidebar is shown, by id — the title bar's sidebar buttons. */
  private readonly shown: WritableSignal<Readonly<Record<string, boolean>>>;

  /** Whether the activity bar is shown: `Ctrl`+`/` puts it away with the sidebars (PRD 001, §9.2.1). */
  readonly activityShown = signal(true);

  constructor(protected readonly parent: UiWorkbenchService) {
    const config = parent.config;
    this.commandLabel = config.commandCenter?.label ?? 'Search commands…';
    this.commandKeys = config.commandCenter?.keys ?? ['Ctrl', 'Shift', 'P'];
    this.sidebarMoreActions = config.sidebarActions ?? [{ id: 'more', label: 'More actions', icon: 'dots' }];
    this.shown = signal(Object.fromEntries(config.sidebars.map((sidebar) => [sidebar.id, true])));
  }

  /* -- sidebars ------------------------------------------------------------ */

  isShown(sidebar: string): boolean {
    return this.shown()[sidebar] ?? false;
  }

  /**
   * Hides or shows a sidebar. Hidden with the keyboard in it, the keyboard
   * goes to the active panel's content, as it does when the bottom panel is
   * put away (PRD 001, §12.3) — else it would be left on nothing.
   */
  toggleSidebar(sidebar: string): void {
    this.setShown([sidebar], !this.isShown(sidebar));
  }

  /**
   * Both sidebars at once, and the activity bar and the bottom panel with
   * them (PRD 001, §9.2.1): either sidebar shown, all go — the panels get the
   * whole window —; both hidden, all come back, the bottom panel as it was.
   */
  toggleSidebars(): void {
    const ids = this.parent.config.sidebars.map((sidebar) => sidebar.id);
    const show = ids.every((id) => !this.isShown(id));
    this.setShown(ids, show);
    this.setActivityShown(show);
    this.parent.bottomPanelFt.setHidden(!show);
  }

  /** The activity bar alone — *View › Toggle Activity Bar*, to bring it back without the sidebars. */
  toggleActivityBar(): void {
    this.setActivityShown(!this.activityShown());
  }

  /** Shows or hides the activity bar; hidden with the keyboard on it, the keyboard goes to the active panel. */
  private setActivityShown(show: boolean): void {
    if (show === this.activityShown()) {
      return;
    }
    const focused = globalThis.document?.activeElement;
    const hadFocus = !show && focused instanceof Element && focused.closest('ui-activity-bar') !== null;
    this.activityShown.set(show);
    if (hadFocus) {
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }

  /** Shows a sidebar if it is hidden — for something shown in it. */
  revealSidebar(sidebar: string): void {
    if (!this.isShown(sidebar)) {
      this.shown.update((shown) => ({ ...shown, [sidebar]: true }));
    }
  }

  /** Shows or hides `sidebars`; one hidden with the keyboard in it hands it to the active panel. */
  private setShown(sidebars: readonly string[], show: boolean): void {
    const hadFocus = !show && sidebars.some((sidebar) => this.isShown(sidebar) && UiChromeFeature.focusIsIn(sidebar));
    this.shown.update((shown) => ({ ...shown, ...Object.fromEntries(sidebars.map((sidebar) => [sidebar, show])) }));
    if (hadFocus) {
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }

  /** Puts the sidebars — and the activity bar — back as a restored session had them. */
  restoreSidebars(hidden: readonly string[], activityHidden = false): void {
    this.shown.set(Object.fromEntries(this.parent.config.sidebars.map((sidebar) => [sidebar.id, !hidden.includes(sidebar.id)])));
    this.activityShown.set(!activityHidden);
  }

  /** The hidden sidebars, for the session. */
  hiddenSidebars(): readonly string[] {
    return this.parent.config.sidebars.map((sidebar) => sidebar.id).filter((sidebar) => !this.isShown(sidebar));
  }

  private static focusIsIn(region: string): boolean {
    const focused = globalThis.document?.activeElement;
    return focused instanceof Element && focused.closest(`[data-focus-region="${region}"]`) !== null;
  }

  /* -- the title bar ------------------------------------------------------- */

  /**
   * The title bar's buttons (PRD 001, §15.1): each a command, pressed while
   * what it toggles is shown — a sidebar's drawn on the side the settings put
   * it (PRD 010, §3) —, the theme's a sun in the dark and a moon in the light.
   */
  readonly titleBarActions = computed<readonly UiIconAction[]>(() => {
    const preferences = this.parent.preferencesFt;
    return (this.parent.config.titleBarActions ?? []).map(({ id, label, icon, toggles }): UiIconAction => {
      if (toggles === 'theme') {
        return preferences.effectiveTheme() === 'dark' ? { id, label: 'Switch to Light Theme', icon: 'sun' } : { id, label: 'Switch to Dark Theme', icon: 'moon' };
      }
      if (toggles === 'bottom-panel') {
        return { id, label, icon, active: !this.parent.bottomPanelFt.collapsed() && !this.parent.bottomPanelFt.hidden() };
      }
      if (toggles?.startsWith('sidebar:')) {
        const sidebar = toggles.slice('sidebar:'.length);
        return { id, label, icon: preferences.sideOf(sidebar) === 'left' ? 'sidebar-left' : 'sidebar-right', active: this.isShown(sidebar) };
      }
      return { id, label, icon };
    });
  });

  /** A title-bar button: its command, so the palette and the menus run the same. */
  runTitleBarAction(id: string): void {
    const action = this.parent.config.titleBarActions?.find((candidate) => candidate.id === id);
    if (action !== undefined) {
      this.parent.commandsFt.run(action.command);
    }
  }

  /* -- the main menu (PRD 001, §16) ---------------------------------------- */

  /** The main menu that is open, if any. */
  private readonly openMenuId = signal<string | null>(null);

  /** The main menu, with the open one marked; each row a command, as it stands for the active panel. */
  readonly menuItems = computed<readonly UiMenuBarItem[]>(() => {
    const open = this.openMenuId();
    const target = this.parent.commandsFt.activeTarget();
    return this.parent.config.menus.map((menu) => ({
      ...menu,
      open: menu.id === open,
      items: (menu.items ?? []).map((item) => this.menuRow(item, target)),
    }));
  });

  /** A row of the main menu: the command's, or the row as configured when it names no command. */
  protected menuRow(item: UiMenuItem, target: UiCommandTarget): UiMenuItem {
    const commands = this.parent.commandsFt;
    return commands.command(item.id) === undefined ? item : commands.menuItem(item.id, target, !!item.separatorBefore);
  }

  /** The first menu opens — Midnight Commander's `F9` (PRD 004, §2). */
  openMainMenu(): void {
    this.openMenuId.set(this.parent.config.menus[0]?.id ?? null);
  }

  /** Opens the main menu `id`, or closes the open one with `null`. */
  setMenuOpen(id: string | null): void {
    this.openMenuId.set(id);
  }

  /** An entry of the main menu was chosen; the menu closes either way, and the entry runs. */
  runMenuItem(selection: UiMenuBarSelection): void {
    this.openMenuId.set(null);
    this.runMenuRow(selection.itemId);
  }

  /** A main-menu row: a command of the table, on the active panel. */
  protected runMenuRow(itemId: string): void {
    this.parent.commandsFt.run(itemId);
  }

  /* -- the activity bar ------------------------------------------------------ */

  /** Where the Settings menu is open — its bottom corner — or `null` (PRD 007, §1). */
  private readonly settingsMenuAt = signal<{ readonly x: number; readonly y: number; readonly leftward?: boolean } | null>(null);

  readonly settingsMenu = this.settingsMenuAt.asReadonly();

  /** What the Settings menu offers: commands of the table, in the menu's own words, checked and enabled as they stand. */
  readonly settingsMenuItems = computed<readonly UiMenuItem[]>(() => {
    const commands = this.parent.commandsFt;
    return this.parent.config.settingsMenu.map((item) =>
      commands.command(item.id) === undefined ? item : { ...commands.menuItem(item.id, commands.activeTarget(), !!item.separatorBefore), label: item.label },
    );
  });

  /** The sub-applications, the one shown marked (PRD 001, §1.1); then the application's own buttons. */
  readonly activityItems = computed<readonly UiActivityItem[]>(() => {
    const apps = this.parent.subAppsFt;
    return [
      ...apps.apps.map((app): UiActivityItem => ({ id: app.id, label: app.label, icon: app.icon, ...(apps.isActive(app.id) ? { active: true } : {}) })),
      ...(this.parent.config.activityItems ?? []),
    ];
  });

  /** The bottom buttons; the Settings gear says whether its menu is open. */
  readonly activityBottomItems = computed<readonly UiActivityItem[]>(() => {
    const menuOpen = this.settingsMenuAt() !== null;
    return (this.parent.config.activityBottomItems ?? []).map((item) => (item.id === 'settings' ? { ...item, expanded: menuOpen, active: menuOpen } : item));
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
      this.parent.preferencesFt.activitySide() === 'right' ? { x: anchor.left, y: anchor.bottom, leftward: true } : { x: anchor.right, y: anchor.bottom },
    );
  }

  closeSettingsMenu(): void {
    this.settingsMenuAt.set(null);
  }

  /** A Settings menu entry was chosen: the menu closes, the command runs. */
  runSettingsItem(id: string): void {
    this.closeSettingsMenu();
    this.parent.commandsFt.run(id);
  }

  /**
   * A click in the activity bar. A sub-application's button brings it
   * forward — the main one with its first sidebar, which may have been put
   * away —; any other is the application's (`runActivity`).
   */
  selectActivity(id: string): void {
    const apps = this.parent.subAppsFt;
    if (apps.apps.some((app) => app.id === id)) {
      apps.show(id);
      if (id === apps.main) {
        this.revealSidebar(this.parent.config.sidebars[0].id);
      }
      return;
    }
    this.runActivity(id);
  }

  /** An activity button that is not a sub-application's: a command of that id, if there is one. */
  protected runActivity(id: string): void {
    if (this.parent.commandsFt.command(id) !== undefined) {
      this.parent.commandsFt.run(id);
    }
  }

  /* -- the status bar -------------------------------------------------------- */

  /** The status bar's items on the left; the application's. */
  readonly statusLeadingItems = computed<readonly UiStatusItem[]>(() => []);

  /** The status bar's items on the right; the application's. */
  readonly statusTrailingItems = computed<readonly UiStatusItem[]>(() => []);

  /** A status-bar item was clicked; the application's to answer. */
  runStatusAction(_id: string): void {
    // Nothing, unless the application says.
  }
}
