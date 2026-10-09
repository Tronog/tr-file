import { inject, makeEnvironmentProviders, Service, signal, type EnvironmentProviders, type Type } from '@angular/core';
import { UiKeymap } from '../keyboard/keymap';
import { UiPanelLayout } from '../layout/ui-panel-layout';
import { UiModalService } from '../modal/ui-modal.service';
import { UI_SETTINGS_STORE, UI_STORAGE_PREFIX } from '../settings/ui-settings-store';
import { UiThemeService } from '../theme/ui-theme.service';
import { UiBottomPanelFeature } from './features/ui-bottom-panel.feature';
import { UiChromeFeature } from './features/ui-chrome.feature';
import { UiCommandPaletteFeature } from './features/ui-command-palette.feature';
import { UiCommandsFeature } from './features/ui-commands.feature';
import { UiContextMenuFeature } from './features/ui-context-menu.feature';
import { UiEditorGroupsFeature } from './features/ui-editor-groups.feature';
import { UiFocusCycleFeature } from './features/ui-focus-cycle.feature';
import { UiHelpFeature } from './features/ui-help.feature';
import { UiKeybindingsFeature } from './features/ui-keybindings.feature';
import { UiPanelFocusFeature } from './features/ui-panel-focus.feature';
import { UiPreferencesFeature } from './features/ui-preferences.feature';
import { UiResizeFeature } from './features/ui-resize.feature';
import { UiSessionFeature, type UiSessionSnapshot } from './features/ui-session.feature';
import { UiSettingsEditorFeature } from './features/ui-settings-editor.feature';
import { UiSidebarPanesFeature } from './features/ui-sidebar-panes.feature';
import { UiSubAppsFeature } from './features/ui-sub-apps.feature';
import type { UiCommandTarget } from './ui-commands.model';
import type { UiGroupState, UiTabState } from './ui-editor.model';
import { UI_WORKBENCH_CONFIG, type UiWorkbenchConfig, type UiWorkbenchLayout } from './ui-workbench.config';

/**
 * The workbench (PRD 001, §17.1): its common state, and one instance of each
 * of its features — the seam they talk through, per `docs/ai/ANGULAR.md`.
 *
 * Deliberately thin: it holds the signals more than one feature needs — the
 * active and previous panel, the regions' sizes — and the features hold the
 * rest: the panels and their layout, the sidebars' panes, the bottom panel,
 * the chrome, the command table, the keys, the palette, the context menus,
 * the focus ring, the preferences, the settings and Help windows, and the
 * session that remembers it all. `<ui-workbench-shell>` draws it.
 *
 * An application extends it: its own features as fields of its subclass,
 * and its own variant of a feature of the library's — a command table, a
 * chrome with its status bar, groups that know what their tabs show — by
 * overriding the `create…` method that makes it. Those are called while this
 * class is being constructed, before the subclass's own fields exist, so a
 * feature must not read the application's features until it is used.
 *
 * Not provided on its own: `provideUiWorkbench(config, Subclass?)`.
 */
@Service({ autoProvided: false })
export class UiWorkbenchService<
  TTab extends UiTabState = UiTabState,
  TGroup extends UiGroupState<TTab> = UiGroupState<TTab>,
  TTarget extends UiCommandTarget = UiCommandTarget,
> {
  /** What the application says its workbench is. */
  readonly config = inject(UI_WORKBENCH_CONFIG) as unknown as UiWorkbenchConfig<TTab, TGroup>;

  /** Modal windows — questions the workbench has to ask (PRD 002, §3). */
  readonly modal = inject(UiModalService);

  /** What is remembered between sessions, and under what keys. */
  readonly settings = inject(UI_SETTINGS_STORE);
  readonly storagePrefix = inject(UI_STORAGE_PREFIX);

  /** The colour theme (PRD 010, §4). */
  readonly theme = inject(UiThemeService);

  /** The keys in force (PRD 010, §2). */
  readonly keymap = inject(UiKeymap);

  /**
   * The last session, when there is one to restore (PRD 003, §6) — read
   * before any feature is made, so each starts from it.
   */
  readonly restored: UiSessionSnapshot<TGroup> | null = UiSessionFeature.restore(this.settings, this.storagePrefix, this.config);

  /** The layout the workbench starts from: the restored session's, or the configuration's. */
  readonly layout: UiWorkbenchLayout<TGroup> = this.restored ?? this.config.layout;

  /* -- common state ------------------------------------------------------ */

  /** The focused panel group: only its tabs and selection render as active. */
  readonly activeGroupId = signal(this.layout.activeGroupId);

  /**
   * The panel group that was active before the active one (PRD 002, §2.7) —
   * one level deep, `null` until there has been another. Kept by the groups,
   * the one place the active group changes.
   */
  readonly previousGroupId = signal<string | null>(null);

  readonly leftSidebarWidth = signal(this.layout.leftSidebarWidth);
  readonly rightSidebarWidth = signal(this.layout.rightSidebarWidth);
  readonly bottomPanelHeight = signal(this.layout.bottomPanelHeight);

  /* -- features ---------------------------------------------------------- */

  /** This service as the library's features see it — whatever the application's tabs, groups and targets are. */
  protected get untyped(): UiWorkbenchService {
    return this as unknown as UiWorkbenchService;
  }

  /** Which sub-application fills the window (PRD 001, §1.1). */
  readonly subAppsFt = this.createSubApps();
  readonly resizeFt = new UiResizeFeature(this.untyped);
  /** The split tree of the panels. */
  readonly panelLayoutFt = new UiPanelLayout(this.layout.grid);
  readonly editorGroupsFt = this.createEditorGroups();
  /** Sends focus into a panel body once a chosen tab has rendered. */
  readonly panelFocusFt = new UiPanelFocusFeature(this.untyped);
  readonly sidebarPanesFt = this.createSidebarPanes();
  readonly bottomPanelFt = this.createBottomPanel();
  readonly commandsFt = this.createCommands();
  readonly keybindingsFt = this.createKeybindings();
  readonly commandPaletteFt = this.createCommandPalette();
  readonly contextMenuFt = this.createContextMenu();
  readonly chromeFt = this.createChrome();
  /** `Ctrl`+`Tab` between the parts of the window (PRD 002, §2.6). */
  readonly focusCycleFt = new UiFocusCycleFeature(this.untyped);
  /** The layout, remembered for the next session (PRD 003, §6). */
  readonly sessionFt = this.createSession();
  /** The settings of the settings window (PRD 010, §1); after the session, whose switch it shows. */
  readonly preferencesFt = this.createPreferences();
  readonly settingsEditorFt = new UiSettingsEditorFeature(this.untyped);
  readonly helpFt = this.createHelp();

  /* -- the features an application may vary ------------------------------ */

  protected createSubApps(): UiSubAppsFeature {
    return new UiSubAppsFeature(this.untyped);
  }

  protected createEditorGroups(): UiEditorGroupsFeature<TTab, TGroup> {
    return new UiEditorGroupsFeature<TTab, TGroup>(this as unknown as UiWorkbenchService<TTab, TGroup>);
  }

  protected createSidebarPanes(): UiSidebarPanesFeature {
    return new UiSidebarPanesFeature(this.untyped);
  }

  protected createBottomPanel(): UiBottomPanelFeature {
    return new UiBottomPanelFeature(this.untyped);
  }

  protected createCommands(): UiCommandsFeature<TTarget> {
    return new UiCommandsFeature<TTarget>(this.untyped);
  }

  protected createKeybindings(): UiKeybindingsFeature {
    return new UiKeybindingsFeature(this.untyped);
  }

  protected createCommandPalette(): UiCommandPaletteFeature {
    return new UiCommandPaletteFeature(this.untyped);
  }

  protected createContextMenu(): UiContextMenuFeature<TTarget> {
    return new UiContextMenuFeature<TTarget>(this.untyped);
  }

  protected createChrome(): UiChromeFeature {
    return new UiChromeFeature(this.untyped);
  }

  protected createSession(): UiSessionFeature<TTab, TGroup> {
    return new UiSessionFeature<TTab, TGroup>(this as unknown as UiWorkbenchService<TTab, TGroup>);
  }

  protected createPreferences(): UiPreferencesFeature {
    return new UiPreferencesFeature(this.untyped);
  }

  protected createHelp(): UiHelpFeature {
    return new UiHelpFeature(this.untyped);
  }

  /* -- starting ------------------------------------------------------------ */

  /**
   * Puts back what the session remembered of the regions, loads what the
   * panels show, and starts remembering. Called once, by the shell or the
   * application, rather than from the constructor — so creating the service
   * in a test does nothing on its own.
   */
  start(): void {
    this.restoreRegions();
    this.editorGroupsFt.start();
    this.panelFocusFt.focusBody(this.activeGroupId());
    this.sessionFt.start();
  }

  /** The bottom panel, the panes and the sidebars, as the session had them. */
  protected restoreRegions(): void {
    const restored = this.restored;
    if (restored === null) {
      return;
    }
    this.bottomPanelFt.restore(restored.bottomPanel.collapsed, restored.bottomPanel.hidden === true);
    this.sidebarPanesFt.restore(restored.panes);
    this.sidebarPanesFt.restoreOrders(restored.paneOrder);
    this.sidebarPanesFt.restoreSizes(restored.paneSizes);
    this.sidebarPanesFt.restoreHidden(restored.hiddenPanes);
    this.chromeFt.restoreSidebars(restored.hiddenSidebars, restored.activityBarHidden === true);
  }
}

/**
 * The workbench of an application (PRD 001, §17.1): its configuration, and
 * the service that runs it — `UiWorkbenchService`, or the application's
 * subclass of it, which the shell's components then find as
 * `UiWorkbenchService` too. Its own `UiKeymap` comes with it, so the keys
 * components add (`UI_KEYBINDING_DEFAULTS`) can be provided beside it — on a
 * lazily loaded route, say — rather than at the root.
 */
export function provideUiWorkbench<TTab extends UiTabState, TGroup extends UiGroupState<TTab>>(
  config: UiWorkbenchConfig<TTab, TGroup> | (() => UiWorkbenchConfig<TTab, TGroup>),
  service?: Type<UiWorkbenchService<TTab, TGroup, UiCommandTarget>>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    UiKeymap,
    typeof config === 'function' ? { provide: UI_WORKBENCH_CONFIG, useFactory: config } : { provide: UI_WORKBENCH_CONFIG, useValue: config },
    ...(service === undefined ? [UiWorkbenchService] : [service, { provide: UiWorkbenchService, useExisting: service }]),
  ]);
}
