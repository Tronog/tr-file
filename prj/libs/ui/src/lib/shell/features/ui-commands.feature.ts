import type { UiMenuItem } from '../../models/chrome.model';
import type { UiCommand, UiCommandSpec, UiCommandTarget } from '../ui-commands.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

const always = (): boolean => true;

/**
 * The one table of commands the workbench offers (PRD 003, §4): the main
 * menu, the context menus, the command palette and the key bindings all name
 * commands from here, so each is written once, is enabled by one rule, and
 * runs the same whichever way it was reached.
 *
 * The library's own commands — tabs, panels, sidebars, panes, the
 * sub-applications, the theme, the layout, the settings and help windows,
 * the palette and the main menu — are `builtins`. An application lists its
 * table by overriding `define`, placing the builtins among its own
 * (`builtin(id)`) — or leaving `define` alone to have them only.
 *
 * The table is made the first time it is asked for, not when the feature is,
 * so an application's commands may name every feature of its service.
 */
export class UiCommandsFeature<T extends UiCommandTarget = UiCommandTarget> {
  private made: ReadonlyMap<string, UiCommand<T>> | null = null;

  constructor(protected readonly parent: UiWorkbenchService) {}

  private get table(): ReadonlyMap<string, UiCommand<T>> {
    this.made ??= new Map(this.define().map((spec) => [spec.id, UiCommandsFeature.complete(spec)]));
    return this.made;
  }

  /** Every command the palette lists, in table order. */
  paletteCommands(): readonly UiCommand<T>[] {
    return [...this.table.values()].filter((command) => command.palette);
  }

  /** Every command of the table, the palette's and the context menus' alike. */
  allCommands(): readonly UiCommand<T>[] {
    return [...this.table.values()];
  }

  command(id: string): UiCommand<T> | undefined {
    return this.table.get(id);
  }

  /** What a menu, a key or the palette acts on: the active panel. */
  activeTarget(): T {
    return { groupId: this.parent.activeGroupId() } as T;
  }

  /** What a tab's context menu acts on. */
  tabTarget(groupId: string, tabId: string): T {
    return { groupId, tabId } as T;
  }

  isEnabled(id: string, target: T = this.activeTarget()): boolean {
    return this.table.get(id)?.enabled(target) ?? false;
  }

  /** Runs a command, if it applies to `target`. */
  run(id: string, target: T = this.activeTarget()): void {
    const command = this.table.get(id);
    if (command === undefined || !command.enabled(target)) {
      return;
    }
    this.ran(id, target, Promise.resolve(command.run(target)));
  }

  /** What follows a command run — `running` settles when it is done. Nothing, unless the application says. */
  protected ran(_id: string, _target: T, _running: Promise<void>): void {
    // The application's.
  }

  /** The menu row for a command: its label and key, disabled or checked as it stands for `target`. */
  menuItem(id: string, target: T = this.activeTarget(), separatorBefore = false): UiMenuItem {
    const command = this.table.get(id);
    if (command === undefined) {
      return { id, label: id, disabled: true };
    }
    const checked = command.checked?.(target);
    // The key shown is the one in force (PRD 010, §2), whatever the user bound.
    const keybinding = this.parent.keybindingsFt.label(id) ?? this.parent.config.fixedKeys?.[id];
    return {
      id,
      label: command.label(target),
      ...(keybinding === undefined ? {} : { keybinding }),
      ...(command.enabled(target) ? {} : { disabled: true }),
      ...(checked === undefined ? {} : { checked }),
      ...(separatorBefore ? { separatorBefore: true } : {}),
    };
  }

  /* -- the table ------------------------------------------------------------ */

  /** The table, in order: the library's own commands, unless the application lists its own. */
  protected define(): readonly UiCommandSpec<T>[] {
    return this.builtins();
  }

  /** A builtin command, to place in an application's table. */
  protected builtin(id: string): UiCommandSpec<T> {
    const spec = this.builtins().find((candidate) => candidate.id === id);
    if (spec === undefined) {
      throw new Error(`No builtin command '${id}'`);
    }
    return spec;
  }

  /** Every builtin with an id starting with `prefix` — `view.pane.`, `view.app.` — in their order. */
  protected builtinsOf(prefix: string): readonly UiCommandSpec<T>[] {
    return this.builtins().filter((spec) => spec.id.startsWith(prefix));
  }

  /** The library's commands. */
  protected builtins(): readonly UiCommandSpec<T>[] {
    const p = this.parent;
    const group = (target: T) => p.editorGroupsFt.stateOf(target.groupId);
    const [first, second] = p.config.sidebars;
    return [
      /* The sub-applications (PRD 001, §1.1), as the activity bar's first buttons. */
      ...p.subAppsFt.apps.map(
        (app): UiCommandSpec<T> => ({
          id: `view.app.${app.id}`,
          category: 'View',
          label: `Show ${app.label}`,
          checked: () => p.subAppsFt.isActive(app.id),
          run: () => p.chromeFt.selectActivity(app.id),
        }),
      ),
      /* The bottom panel (PRD 001, §12.3) and the sidebars (§9.2.1). */
      { id: 'view.togglePanel', category: 'View', label: 'Toggle Panel', run: () => p.bottomPanelFt.toggleCollapsed() },
      ...p.config.sidebars.map(
        (sidebar): UiCommandSpec<T> => ({ id: sidebar.toggleCommand, category: 'View', label: `Toggle ${sidebar.label}`, run: () => p.chromeFt.toggleSidebar(sidebar.id) }),
      ),
      { id: 'view.toggleSidebars', category: 'View', label: `Toggle ${first.label} and ${second.label}`, run: () => p.chromeFt.toggleSidebars() },
      {
        id: 'view.toggleActivityBar',
        category: 'View',
        label: 'Toggle Activity Bar',
        checked: () => p.chromeFt.activityShown(),
        run: () => p.chromeFt.toggleActivityBar(),
      },
      /* The sidebars' `…` menus (PRD 001, §9.2): one row per pane, checked while it is shown. */
      ...p.config.sidebars.flatMap((sidebar) =>
        sidebar.panes.map(
          (pane): UiCommandSpec<T> => ({
            id: `view.pane.${pane.id}`,
            category: 'View',
            label: pane.label,
            palette: false,
            checked: () => p.sidebarPanesFt.isShown(pane.id),
            // The last pane shown stays: the row that would hide it is off.
            enabled: () => !p.sidebarPanesFt.isShown(pane.id) || p.sidebarPanesFt.canHide(pane.id),
            run: () => p.sidebarPanesFt.toggleShown(pane.id),
          }),
        ),
      ),
      /* The session (PRD 003, §6) and the theme (PRD 001, §8.2.2). */
      {
        id: 'settings.restoreSession',
        category: 'Preferences',
        label: 'Restore Layout on Start',
        // Through the settings (PRD 010, §1), so the window shows the switch as it stands.
        checked: () => p.preferencesFt.value('window.restoreLayout'),
        run: () => p.preferencesFt.set('window.restoreLayout', !p.preferencesFt.value('window.restoreLayout')),
      },
      {
        id: 'view.toggleTheme',
        category: 'Preferences',
        label: () => (p.preferencesFt.effectiveTheme() === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'),
        run: () => p.preferencesFt.toggleTheme(),
      },
      { id: 'view.resetLayout', category: 'View', label: 'Reset Layout', run: () => void p.sessionFt.confirmResetLayout() },
      /* The settings window (PRD 010) and Help (PRD 001, §16). */
      { id: 'workbench.openSettings', category: 'Preferences', label: 'Open Settings', run: () => p.settingsEditorFt.open() },
      { id: 'workbench.openKeybindings', category: 'Preferences', label: 'Open Keyboard Shortcuts', run: () => p.settingsEditorFt.open('keyboard-shortcuts') },
      { id: 'help.show', category: 'Help', label: 'Show Help', run: () => p.helpFt.open() },
      { id: 'help.cheatsheet', category: 'Help', label: 'Keyboard Shortcuts Cheatsheet', run: () => p.helpFt.open('cheatsheet') },
      /* The window. */
      { id: 'view.commandPalette', category: 'View', label: 'Show All Commands', palette: false, run: () => p.commandPaletteFt.show() },
      { id: 'view.mainMenu', category: 'View', label: 'Open the Main Menu', palette: false, run: () => p.chromeFt.openMainMenu() },
      /* Tabs and panels. */
      { id: 'tab.new', category: 'Tab', label: 'New Tab', run: (t) => p.editorGroupsFt.newTab(t.groupId) },
      {
        id: 'view.toggleMaximize',
        category: 'View',
        label: 'Toggle Maximized Panel',
        checked: (t) => p.panelLayoutFt.isMaximized(t.groupId),
        run: (t) => p.editorGroupsFt.runAction(t.groupId, 'maximize'),
      },
      /* … the rest from a tab's context menu only */
      { id: 'tab.close', category: 'Tab', label: 'Close', palette: false, enabled: (t) => t.tabId !== undefined, run: (t) => p.editorGroupsFt.closeTab(t.groupId, t.tabId as string) },
      {
        id: 'tab.closeOthers',
        category: 'Tab',
        label: 'Close Others',
        palette: false,
        enabled: (t) => t.tabId !== undefined && (group(t)?.tabs.length ?? 0) > 1,
        run: (t) => this.closeTabs(t, (index, at) => index !== at),
      },
      {
        id: 'tab.closeRight',
        category: 'Tab',
        label: 'Close to the Right',
        palette: false,
        enabled: (t) => {
          const tabs = group(t)?.tabs ?? [];
          const at = tabs.findIndex((tab) => tab.id === t.tabId);
          return at !== -1 && at < tabs.length - 1;
        },
        run: (t) => this.closeTabs(t, (index, at) => index > at),
      },
    ];
  }

  /** Closes the tabs of `target`'s group that `close` picks, by index against the target tab's. */
  private closeTabs(target: T, close: (index: number, at: number) => boolean): void {
    const groups = this.parent.editorGroupsFt;
    const tabs = groups.stateOf(target.groupId)?.tabs ?? [];
    const at = tabs.findIndex((tab) => tab.id === target.tabId);
    for (const tab of tabs.filter((_tab, index) => close(index, at))) {
      groups.closeTab(target.groupId, tab.id);
    }
  }

  private static complete<T extends UiCommandTarget>(spec: UiCommandSpec<T>): UiCommand<T> {
    const { label } = spec;
    return {
      ...spec,
      label: typeof label === 'string' ? () => label : label,
      palette: spec.palette ?? true,
      enabled: spec.enabled ?? always,
    };
  }
}
