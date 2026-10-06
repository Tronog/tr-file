import { computed, signal, type Signal } from '@angular/core';
import { uiPreferencesKey } from '../../settings/ui-settings-store';
import { UI_THEME_PREFERENCE, type UiColorTheme } from '../../theme/ui-theme.service';
import type { UiPreference, UiPreferenceOption, UiSidebarDef } from '../ui-workbench.config';
import type { UiWorkbenchService } from '../ui-workbench.service';

/** The colour themes (PRD 010, §4). */
const THEMES: readonly UiPreferenceOption[] = [
  { value: 'dark', label: 'Dark Modern' },
  { value: 'light', label: 'Light Modern' },
  { value: 'system', label: 'Follow the System' },
];

/** Where a sidebar goes (PRD 010, §3). */
const SIDES: readonly UiPreferenceOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

/** *Workbench: Color Theme* (PRD 010, §4) — applied by `UiThemeService`. */
export function uiColorThemePreference(section = 'appearance'): UiPreference {
  return {
    id: UI_THEME_PREFERENCE,
    section,
    group: 'Workbench',
    category: 'Workbench',
    title: 'Color Theme',
    description: 'The colours of the whole window: dark or light, after VS Code — or whichever the system prefers.',
    kind: { type: 'choice', default: 'dark', options: THEMES },
  };
}

/** *<Sidebar>: Location* (PRD 010, §3) — name it as the sidebar's `locationSetting`. */
export function uiSidebarLocationPreference(sidebar: UiSidebarDef, description: string, section = 'appearance'): UiPreference {
  return {
    id: sidebar.locationSetting ?? `workbench.${sidebar.id}Location`,
    section,
    group: 'Workbench',
    category: sidebar.label,
    title: 'Location',
    description,
    kind: { type: 'choice', default: sidebar.side, options: SIDES },
  };
}

/** *Window: Restore Layout on Start* (PRD 003, §6) — kept by the session. */
export function uiRestoreLayoutPreference(section = 'general'): UiPreference {
  return {
    id: 'window.restoreLayout',
    section,
    group: 'Window',
    category: 'Window',
    title: 'Restore Layout on Start',
    description: 'Open the panels, tabs and folders that were open when the window was last closed.',
    kind: { type: 'boolean', default: true },
  };
}

/** *Window: Reset Layout* (PRD 001, §15.1.1) — the command, asking first. */
export function uiResetLayoutPreference(section = 'general'): UiPreference {
  return {
    id: 'window.resetLayout',
    section,
    group: 'Window',
    category: 'Window',
    title: 'Reset Layout',
    description: 'Forget the remembered layout and start the window over with the default one.',
    kind: { type: 'action', label: 'Reset Layout', command: 'view.resetLayout' },
  };
}

/**
 * Every setting the settings window shows (PRD 010, §1) —
 * `UiWorkbenchConfig.preferences` — and their values.
 *
 * Values are kept under `<prefix>.preferences.v1`, and only while they differ
 * from their default, so a changed default reaches everyone who never touched
 * it. Some are kept elsewhere and only read and written through here:
 * *Restore Layout on Start* by the session, and whatever an application keeps
 * its own way (`read`, `write`). *Color Theme* is applied by `UiThemeService`,
 * and a sidebar's location (`UiSidebarDef.locationSetting`) moves it.
 */
export class UiPreferencesFeature {
  /** The preferences of their own that differ from their default. */
  private readonly stored = signal<Readonly<Record<string, boolean | string>>>({});

  private readonly key: string;

  /** Each sidebar's edge, by id (PRD 010, §3) — each on its own: both may be on the same side. */
  private readonly sides: Readonly<Record<string, Signal<'left' | 'right'>>>;

  constructor(protected readonly parent: UiWorkbenchService) {
    this.key = uiPreferencesKey(parent.storagePrefix);
    const raw = parent.settings.get<unknown>(this.key);
    const stored: Record<string, boolean | string> = {};
    if (typeof raw === 'object' && raw !== null) {
      for (const [id, value] of Object.entries(raw)) {
        const kind = this.find(id)?.kind;
        if (
          (typeof value === 'boolean' && kind?.type === 'boolean') ||
          (typeof value === 'string' && kind?.type === 'choice' && kind.options.some((option) => option.value === value))
        ) {
          stored[id] = value;
        }
      }
    }
    this.stored.set(stored);
    this.sides = Object.fromEntries(
      parent.config.sidebars.map((sidebar) => [
        sidebar.id,
        computed(() => {
          const chosen = sidebar.locationSetting === undefined ? '' : this.choice(sidebar.locationSetting);
          return chosen === 'left' || chosen === 'right' ? chosen : sidebar.side;
        }),
      ]),
    );
  }

  /** Every setting, as the configuration lists them. */
  get all(): readonly UiPreference[] {
    return this.parent.config.preferences ?? [];
  }

  find(id: string): UiPreference | undefined {
    return this.all.find((preference) => preference.id === id);
  }

  /** A switch's value now; `false` for anything that is not a switch. */
  value(id: string): boolean {
    if (id === 'window.restoreLayout') {
      return this.parent.sessionFt.restoresSessions();
    }
    const own = this.read(id);
    if (own !== undefined) {
      return own;
    }
    const preference = this.find(id);
    if (preference?.kind.type !== 'boolean') {
      return false;
    }
    const stored = this.stored()[id];
    return typeof stored === 'boolean' ? stored : preference.kind.default;
  }

  /** A switch the application keeps its own way; `undefined` for one kept here. */
  protected read(_id: string): boolean | undefined {
    return undefined;
  }

  /** Sets a switch the application keeps its own way; `false` for one kept here. */
  protected write(_id: string, _value: boolean): boolean {
    return false;
  }

  /** What changes at once when a switch kept here does; the rest read `value` as they go. */
  protected applied(_id: string, _value: boolean): void {
    // The application's.
  }

  /** A choice's value now; `''` for anything that is not a choice. */
  choice(id: string): string {
    const preference = this.find(id);
    if (preference?.kind.type !== 'choice') {
      return '';
    }
    const stored = this.stored()[id];
    return typeof stored === 'string' ? stored : preference.kind.default;
  }

  /** The edge a sidebar is at (PRD 010, §3). */
  sideOf(sidebar: string): 'left' | 'right' {
    return this.sides[sidebar]?.() ?? 'left';
  }

  /** The activity bar's edge: beside the first sidebar. */
  readonly activitySide = computed(() => this.sideOf(this.parent.config.sidebars[0].id));

  /** Whether a setting is set to something other than its default. */
  isModified(id: string): boolean {
    const kind = this.find(id)?.kind;
    if (kind?.type === 'choice') {
      return this.choice(id) !== kind.default;
    }
    return kind?.type === 'boolean' && this.value(id) !== kind.default;
  }

  /** Makes a choice, if `value` is one of its options. */
  choose(id: string, value: string): void {
    const kind = this.find(id)?.kind;
    if (kind?.type !== 'choice' || !kind.options.some((option) => option.value === value)) {
      return;
    }
    this.keep(id, value, kind.default);
    if (id === UI_THEME_PREFERENCE) {
      this.parent.theme.choice.set(value as UiColorTheme);
    }
  }

  /** The theme in force — the one chosen, or the system's while following it. */
  readonly effectiveTheme = computed(() => this.parent.theme.theme());

  /**
   * The title bar's sun / moon (PRD 001, §8.2.2): the other of light and dark,
   * chosen outright — so a window that followed the system stops following it.
   */
  toggleTheme(): void {
    const next = this.parent.theme.theme() === 'dark' ? 'light' : 'dark';
    if (this.find(UI_THEME_PREFERENCE) === undefined) {
      this.parent.theme.choice.set(next);
      return;
    }
    this.choose(UI_THEME_PREFERENCE, next);
  }

  set(id: string, value: boolean): void {
    if (id === 'window.restoreLayout') {
      this.parent.sessionFt.setRestoresSessions(value);
      return;
    }
    if (this.write(id, value)) {
      return;
    }
    const preference = this.find(id);
    if (preference?.kind.type !== 'boolean') {
      return;
    }
    this.keep(id, value, preference.kind.default);
    this.applied(id, value);
  }

  /** Stores a value — only while it differs from the default. */
  private keep(id: string, value: boolean | string, byDefault: boolean | string): void {
    this.stored.update((stored) => {
      const { [id]: _previous, ...rest } = stored;
      return value === byDefault ? rest : { ...rest, [id]: value };
    });
    const stored = this.stored();
    this.parent.settings.set(this.key, Object.keys(stored).length === 0 ? null : stored);
  }

  /** Puts a setting back to its default. */
  reset(id: string): void {
    const kind = this.find(id)?.kind;
    if (kind?.type === 'boolean') {
      this.set(id, kind.default);
    } else if (kind?.type === 'choice') {
      this.choose(id, kind.default);
    }
  }

  /** Runs an action setting's command. */
  run(id: string): void {
    const preference = this.find(id);
    if (preference?.kind.type === 'action') {
      this.parent.commandsFt.run(preference.kind.command);
    }
  }
}
