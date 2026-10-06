import { computed, inject, signal } from '@angular/core';
import { UiThemeService, type UiColorTheme } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** Where the preferences of their own are kept (PRD 010, §1) — for every backend alike. */
export const PREFERENCES_KEY = 'tr-file.preferences.v1';

/** The pages of the settings window that hold settings; Keyboard Shortcuts is the third. */
export type PreferenceSection = 'general' | 'appearance';

/** One setting: a switch, or a thing to do. */
export interface Preference {
  readonly id: string;
  readonly section: PreferenceSection;
  /** The heading it is listed under on its page. */
  readonly group: string;
  /** `Category: Title`, as VS Code writes a setting. */
  readonly category: string;
  readonly title: string;
  readonly description: string;
  /**
   * A switch, with its default; a choice among `options`, with its default;
   * or an action, with its button's label and the command it runs.
   */
  readonly kind:
    | { readonly type: 'boolean'; readonly default: boolean }
    | { readonly type: 'choice'; readonly default: string; readonly options: readonly PreferenceOption[] }
    | { readonly type: 'action'; readonly label: string; readonly command: string };
}

export interface PreferenceOption {
  readonly value: string;
  readonly label: string;
}

/** The colour themes (PRD 010, §4). */
const THEMES: readonly PreferenceOption[] = [
  { value: 'dark', label: 'Dark Modern' },
  { value: 'light', label: 'Light Modern' },
  { value: 'system', label: 'Follow the System' },
];

/** Where a sidebar goes (PRD 010, §3). */
const SIDES: readonly PreferenceOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

/**
 * Every setting the settings window shows (PRD 010, §1), and their values.
 *
 * Each is something the workbench really does differently: two were already
 * kept elsewhere — hidden files in the session, restoring the layout by
 * `SessionFeature` — and are only read and written through here; the others
 * are kept under `PREFERENCES_KEY`, and only while they differ from their
 * default, so a changed default reaches everyone who never touched it.
 */
export const PREFERENCES: readonly Preference[] = [
  {
    id: 'files.showHidden',
    section: 'general',
    group: 'Files',
    category: 'Files',
    title: 'Show Hidden Files',
    description: 'Show files and folders whose names start with a dot, in the panels and the explorer.',
    kind: { type: 'boolean', default: false },
  },
  {
    id: 'files.autoRefresh',
    section: 'general',
    group: 'Files',
    category: 'Files',
    title: 'Auto Refresh',
    description: 'Read the folders on screen again when something else changes them on disk.',
    kind: { type: 'boolean', default: true },
  },
  {
    id: 'window.restoreLayout',
    section: 'general',
    group: 'Window',
    category: 'Window',
    title: 'Restore Layout on Start',
    description: 'Open the panels, tabs and folders that were open when the window was last closed.',
    kind: { type: 'boolean', default: true },
  },
  {
    id: 'window.resetLayout',
    section: 'general',
    group: 'Window',
    category: 'Window',
    title: 'Reset Layout',
    description: 'Forget the remembered layout and start the window over with the default one.',
    kind: { type: 'action', label: 'Reset Layout', command: 'view.resetLayout' },
  },
  {
    id: 'places.clearRecent',
    section: 'general',
    group: 'Places',
    category: 'Places',
    title: 'Clear Recent Folders',
    description: 'Forget the folders listed under Recent in the explorer.',
    kind: { type: 'action', label: 'Clear Recent Folders', command: 'places.clearRecent' },
  },
  {
    id: 'workbench.functionKeyBar',
    section: 'appearance',
    group: 'Workbench',
    category: 'Workbench',
    title: 'Function Key Bar',
    description: "Show Midnight Commander's function keys in the middle of the status bar.",
    kind: { type: 'boolean', default: true },
  },
  {
    id: 'workbench.colorTheme',
    section: 'appearance',
    group: 'Workbench',
    category: 'Workbench',
    title: 'Color Theme',
    description: 'The colours of the whole window: dark or light, after VS Code — or whichever the system prefers.',
    kind: { type: 'choice', default: 'dark', options: THEMES },
  },
  {
    id: 'workbench.explorerLocation',
    section: 'appearance',
    group: 'Workbench',
    category: 'Explorer',
    title: 'Location',
    description: 'Which side of the window the Explorer is on, with the activity bar beside it.',
    kind: { type: 'choice', default: 'left', options: SIDES },
  },
  {
    id: 'workbench.detailsLocation',
    section: 'appearance',
    group: 'Workbench',
    category: 'Details',
    title: 'Location',
    description: 'Which side of the window the Details sidebar is on. On the same side as the Explorer, it stands beside it, nearer the panels.',
    kind: { type: 'choice', default: 'right', options: SIDES },
  },
  {
    id: 'files.thumbnails',
    section: 'appearance',
    group: 'Files',
    category: 'Files',
    title: 'Thumbnails',
    description: 'Draw a small picture of each image in the icon view, instead of its file icon.',
    kind: { type: 'boolean', default: true },
  },
];

export class PreferencesFeature {
  /** The preferences of their own that differ from their default. */
  private readonly stored = signal<Readonly<Record<string, boolean | string>>>({});

  /** Applies the colour theme; it keeps the choice it read at start in step with this one. */
  private readonly theme = inject(UiThemeService);

  /** Mirrors `SessionFeature.restoresSessions`, which is read from storage and so cannot be watched. */
  private readonly restoreLayout = signal(true);

  constructor(private readonly parent: WorkbenchService) {
    const raw = parent.settings.get<unknown>(PREFERENCES_KEY);
    const stored: Record<string, boolean | string> = {};
    if (typeof raw === 'object' && raw !== null) {
      for (const [id, value] of Object.entries(raw)) {
        const kind = PreferencesFeature.find(id)?.kind;
        if (
          (typeof value === 'boolean' && kind?.type === 'boolean') ||
          (typeof value === 'string' && kind?.type === 'choice' && kind.options.some((option) => option.value === value))
        ) {
          stored[id] = value;
        }
      }
    }
    this.stored.set(stored);
    this.restoreLayout.set(parent.sessionFt.restoresSessions);
  }

  static find(id: string): Preference | undefined {
    return PREFERENCES.find((preference) => preference.id === id);
  }

  /** A switch's value now; `false` for anything that is not a switch. */
  value(id: string): boolean {
    switch (id) {
      case 'files.showHidden':
        return this.parent.showHidden();
      case 'window.restoreLayout':
        return this.restoreLayout();
      default: {
        const preference = PreferencesFeature.find(id);
        if (preference?.kind.type !== 'boolean') {
          return false;
        }
        const stored = this.stored()[id];
        return typeof stored === 'boolean' ? stored : preference.kind.default;
      }
    }
  }

  /** A choice's value now; `''` for anything that is not a choice. */
  choice(id: string): string {
    const preference = PreferencesFeature.find(id);
    if (preference?.kind.type !== 'choice') {
      return '';
    }
    const stored = this.stored()[id];
    return typeof stored === 'string' ? stored : preference.kind.default;
  }

  /**
   * The edge each sidebar is at (PRD 010, §3) — each on its own: both may be
   * on the same side.
   */
  readonly explorerSide = computed(() => (this.choice('workbench.explorerLocation') === 'right' ? 'right' : 'left'));
  readonly detailsSide = computed(() => (this.choice('workbench.detailsLocation') === 'left' ? 'left' : 'right'));

  /** Whether a setting is set to something other than its default. */
  isModified(id: string): boolean {
    const kind = PreferencesFeature.find(id)?.kind;
    if (kind?.type === 'choice') {
      return this.choice(id) !== kind.default;
    }
    return kind?.type === 'boolean' && this.value(id) !== kind.default;
  }

  /** Makes a choice, if `value` is one of its options. */
  choose(id: string, value: string): void {
    const kind = PreferencesFeature.find(id)?.kind;
    if (kind?.type !== 'choice' || !kind.options.some((option) => option.value === value)) {
      return;
    }
    this.keep(id, value, kind.default);
    if (id === 'workbench.colorTheme') {
      this.theme.choice.set(value as UiColorTheme);
    }
  }

  /** The theme in force — the one chosen, or the system's while following it. */
  readonly effectiveTheme = computed(() => this.theme.theme());

  /**
   * The title bar's sun / moon (PRD 001, §8.2.2): the other of light and dark,
   * chosen outright — so a window that followed the system stops following it.
   */
  toggleTheme(): void {
    this.choose('workbench.colorTheme', this.theme.theme() === 'dark' ? 'light' : 'dark');
  }

  set(id: string, value: boolean): void {
    const preference = PreferencesFeature.find(id);
    if (preference?.kind.type !== 'boolean') {
      return;
    }
    switch (id) {
      case 'files.showHidden':
        this.parent.showHidden.set(value);
        return;
      case 'window.restoreLayout':
        this.parent.sessionFt.setRestoresSessions(value);
        this.restoreLayout.set(value);
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
    this.parent.settings.set(PREFERENCES_KEY, Object.keys(stored).length === 0 ? null : stored);
  }

  /** Puts a setting back to its default. */
  reset(id: string): void {
    const kind = PreferencesFeature.find(id)?.kind;
    if (kind?.type === 'boolean') {
      this.set(id, kind.default);
    } else if (kind?.type === 'choice') {
      this.choose(id, kind.default);
    }
  }

  /** Runs an action setting's command. */
  run(id: string): void {
    const preference = PreferencesFeature.find(id);
    if (preference?.kind.type === 'action') {
      this.parent.commandsFt.run(preference.kind.command);
    }
  }

  /** What changes at once when a switch does; the rest read `value` as they go. */
  private applied(id: string, value: boolean): void {
    if (id === 'files.autoRefresh') {
      if (value) {
        this.parent.autoRefreshFt.start();
      } else {
        this.parent.autoRefreshFt.stop();
      }
    }
  }

  /** Whether auto refresh is on — `WorkbenchService.start` asks before starting it. */
  readonly autoRefresh = computed(() => this.value('files.autoRefresh'));
}
