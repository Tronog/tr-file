import { InjectionToken } from '@angular/core';
import type { UiKeyContext, UiKeybinding } from '../keyboard/keymap';
import type { UiActivityItem, UiMenuBarItem, UiMenuItem } from '../models/chrome.model';
import type { UiCheatsheetHue, UiHelpTab } from '../models/help.model';
import type { UiIconAction, UiIconName } from '../models/icon.model';
import type { UiEmptyStateModel, UiGridNode } from '../models/panel.model';
import type { UiSettingsSection } from '../models/settings.model';
import type { UiGroupState, UiPanelContentDef, UiTabState } from './ui-editor.model';

/** Where the workbench starts when there is no session to restore: the panels and the regions' sizes. */
export interface UiWorkbenchLayout<TGroup extends UiGroupState = UiGroupState> {
  /** The split tree of the panels (`UiPanelLayout`). */
  readonly grid: UiGridNode;
  /** One per leaf of `grid`. */
  readonly groups: readonly TGroup[];
  readonly activeGroupId: string;
  readonly leftSidebarWidth: number;
  readonly rightSidebarWidth: number;
  readonly bottomPanelHeight: number;
}

/**
 * A sub-application of the window (PRD 001, §1.1). They share the title bar,
 * the activity bar and the status bar; the `main` one — the first, unless
 * another says so — is the one with the panels, the sidebars and the bottom
 * panel, and each other fills the centre on its own (`<ng-template uiSubApp>`).
 */
export interface UiSubApp {
  readonly id: string;
  /** Its name: the activity bar's tooltip, and the palette's *View: Show …*. */
  readonly label: string;
  readonly icon: UiIconName;
  readonly main?: boolean;
}

/** A pane of a sidebar (PRD 002, §5): movable, resizable, collapsible, and hidden from the sidebar's `…` menu. */
export interface UiPaneDef {
  readonly id: string;
  /** Its header, and its row in the sidebar's `…` menu. */
  readonly label: string;
  /** Open when the window starts. */
  readonly expanded?: boolean;
  /** Hidden from the sidebar until shown from its `…` menu (PRD 001, §9.2). */
  readonly hidden?: boolean;
}

/**
 * One of the two sidebars (PRD 001, §9). The first of `UiWorkbenchConfig.sidebars`
 * is `UiWorkbench`'s `left` slot and the activity bar goes beside it; the
 * second is `right`. Either may be put at either edge (PRD 010, §3).
 */
export interface UiSidebarDef {
  /** Also its focus region (`data-focus-region`) and its name in the session. */
  readonly id: string;
  readonly label: string;
  /** The edge it starts at. */
  readonly side: 'left' | 'right';
  /** The command that hides and shows it — a key, a menu row and the title bar's button run it. */
  readonly toggleCommand: string;
  /** Its location in the settings window, if it has one: a `UiPreference` choosing `left` or `right`. */
  readonly locationSetting?: string;
  readonly panes: readonly UiPaneDef[];
}

/** The bottom panel (PRD 001, §12): its tabs, the one it starts on, and whether it starts collapsed. */
export interface UiBottomPanelConfig {
  readonly label: string;
  readonly tabs: readonly { readonly id: string; readonly label: string }[];
  readonly defaultTab: string;
  /** `true` unless said otherwise: its tab bar only, until something happens (§12.1). */
  readonly collapsed?: boolean;
}

/**
 * A title-bar button: a command, shown pressed while what it `toggles` is
 * shown — a sidebar, the bottom panel — or as the theme it would switch to.
 */
export interface UiTitleBarActionDef {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly command: string;
  readonly toggles?: 'theme' | 'bottom-panel' | `sidebar:${string}`;
}

/** A card of the Help window's cheatsheet (PRD 001, §16.1) made of commands, their keys read from the table in force. */
export interface UiHelpSubject {
  readonly id: string;
  readonly title: string;
  readonly hue: UiCheatsheetHue;
  readonly commands: readonly string[];
}

/** A card of keys no one can change, written out: each row its chords (`[['Ctrl', '↓']]`) and what they do. */
export interface UiHelpFixedCard {
  readonly id: string;
  readonly title: string;
  readonly hue: UiCheatsheetHue;
  readonly rows: readonly (readonly [keys: readonly (readonly string[])[], label: string])[];
}

/** What the Help window shows (PRD 001, §16). */
export interface UiHelpConfig {
  /** Its pages; the first is the cheatsheet, which the library draws. Others are the application's (`HelpModal`'s content). */
  readonly tabs?: readonly UiHelpTab[];
  readonly subjects: readonly UiHelpSubject[];
  /** A card of window keys listed on their own, before the rest — tr-file's function keys. */
  readonly keyCard?: { readonly id: string; readonly title: string; readonly hue: UiCheatsheetHue; readonly note?: string; readonly keys: readonly string[] };
  readonly fixed?: readonly UiHelpFixedCard[];
  /** Where a key applies, when narrower than its card says. */
  readonly where?: Partial<Record<UiKeyContext, string>>;
}

/** One setting of the settings window (PRD 010, §1): a switch, a choice, or a thing to do. */
export interface UiPreference {
  readonly id: string;
  /** The page it is on: one of `UiWorkbenchConfig.settingsSections`. */
  readonly section: string;
  /** The heading it is listed under on its page. */
  readonly group: string;
  /** `Category: Title`, as VS Code writes a setting. */
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly kind:
    | { readonly type: 'boolean'; readonly default: boolean }
    | { readonly type: 'choice'; readonly default: string; readonly options: readonly UiPreferenceOption[] }
    | { readonly type: 'action'; readonly label: string; readonly command: string };
}

export interface UiPreferenceOption {
  readonly value: string;
  readonly label: string;
}

/** The panels: what a tab of each kind is drawn by, and what the session keeps of the application's own fields. */
export interface UiEditorConfig<TTab extends UiTabState = UiTabState, TGroup extends UiGroupState<TTab> = UiGroupState<TTab>> {
  readonly contents: readonly UiPanelContentDef[];
  /** Shown in a group with no tabs. */
  readonly emptyState: UiEmptyStateModel;
  /** A group with no tabs, when the last one closes. */
  emptyGroup(id: string): TGroup;
  /**
   * A tab of a remembered session, its library fields already checked: the
   * application's fields, or `null` when they do not hold together — and the
   * session is not restored.
   */
  readTab?(raw: Readonly<Record<string, unknown>>, tab: UiTabState): TTab | null;
  /** A group of a remembered session, its tabs already read: the application's fields, or `null`. */
  readGroup?(raw: Readonly<Record<string, unknown>>, group: UiGroupState<TTab>): TGroup | null;
  /** What a group of the session keeps: by default everything but `remembered` and `openedFrom` of its tabs. */
  writeGroup?(group: TGroup): TGroup;
}

/**
 * Everything an application says about its workbench, as data (PRD 001,
 * §17.1) — `provideUiWorkbench(config)`. What it does at run time — the
 * commands, the content of the panels, the sidebars' panes — it adds to
 * `UiWorkbenchService` and draws in `<ui-workbench-shell>`.
 */
export interface UiWorkbenchConfig<TTab extends UiTabState = UiTabState, TGroup extends UiGroupState<TTab> = UiGroupState<TTab>> {
  /** The window's name, as the title bar's heading. */
  readonly title: string;
  /** The title bar's icon, before the menus. */
  readonly icon?: UiIconName;
  readonly layout: UiWorkbenchLayout<TGroup>;
  readonly subApps: readonly UiSubApp[];
  /** The left slot's sidebar and the right slot's (PRD 001, §9). */
  readonly sidebars: readonly [UiSidebarDef, UiSidebarDef];
  /** Panes of no sidebar's list that start open all the same — a view drawn in place of a sidebar's panes. */
  readonly expandedPanes?: readonly string[];
  /** The `…` of each sidebar's header. */
  readonly sidebarActions?: readonly UiIconAction[];
  readonly bottomPanel: UiBottomPanelConfig;
  /** The main menu (PRD 001, §16): rows are commands by id. */
  readonly menus: readonly UiMenuBarItem[];
  /** The activity bar's Settings gear's menu (PRD 007, §1): commands by id; the gear is the bottom item `settings`. */
  readonly settingsMenu: readonly UiMenuItem[];
  /** The activity bar's buttons after the sub-applications'. */
  readonly activityItems?: readonly UiActivityItem[];
  /** The activity bar's bottom buttons: a `settings` one with `hasMenu` opens `settingsMenu`. */
  readonly activityBottomItems?: readonly UiActivityItem[];
  readonly titleBarActions?: readonly UiTitleBarActionDef[];
  /** The title bar's command centre, which opens the palette. */
  readonly commandCenter?: { readonly label: string; readonly keys: readonly string[] };
  readonly editor: UiEditorConfig<TTab, TGroup>;
  /** The application's own keys — the window's above all — after the components' (`UiKeymap.defaults`), first binding first. */
  readonly keybindings?: readonly UiKeybinding[];
  /** Names of commands that are keys only, for the Keyboard Shortcuts page and the cheatsheet. */
  readonly keyCommands?: Readonly<Record<string, { readonly category: string; readonly label: string }>>;
  /** Keys a menu shows beside a command that are not the keymap's — a desktop shell's own accelerators. */
  readonly fixedKeys?: Readonly<Record<string, string>>;
  /** The settings window's pages of settings; *Keyboard Shortcuts* follows them. */
  readonly settingsSections?: readonly UiSettingsSection[];
  readonly preferences?: readonly UiPreference[];
  readonly help?: UiHelpConfig;
  /** Rows of a tab's context menu, by command id; `'-'` starts a section. */
  readonly tabMenu?: readonly string[];
  /** Which session is restored: one per scope (tr-file: per backend). `local` unless said. */
  readonly sessionScope?: () => string;
  /** The application's fields of a remembered session, read back; anything else in it is left. */
  readonly readSession?: (raw: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
  /** Sizes the sashes keep the regions within. */
  readonly sizes?: {
    readonly left?: { readonly min: number; readonly max: number };
    readonly right?: { readonly min: number; readonly max: number };
    readonly bottom?: { readonly min: number; readonly max: number };
  };
}

export const UI_WORKBENCH_CONFIG = new InjectionToken<UiWorkbenchConfig>('UI_WORKBENCH_CONFIG');
