import { computed, signal } from '@angular/core';
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
  /** A switch, with its default — or an action, with its button's label and the command it runs. */
  readonly kind: { readonly type: 'boolean'; readonly default: boolean } | { readonly type: 'action'; readonly label: string; readonly command: string };
}

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
  private readonly stored = signal<Readonly<Record<string, boolean>>>({});

  /** Mirrors `SessionFeature.restoresSessions`, which is read from storage and so cannot be watched. */
  private readonly restoreLayout = signal(true);

  constructor(private readonly parent: WorkbenchService) {
    const raw = parent.settings.get<unknown>(PREFERENCES_KEY);
    const stored: Record<string, boolean> = {};
    if (typeof raw === 'object' && raw !== null) {
      for (const [id, value] of Object.entries(raw)) {
        if (typeof value === 'boolean' && PreferencesFeature.find(id)?.kind.type === 'boolean') {
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
        return this.stored()[id] ?? preference.kind.default;
      }
    }
  }

  /** Whether a switch is set to something other than its default. */
  isModified(id: string): boolean {
    const preference = PreferencesFeature.find(id);
    return preference?.kind.type === 'boolean' && this.value(id) !== preference.kind.default;
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
    const byDefault = preference.kind.default;
    this.stored.update((stored) => {
      const { [id]: _previous, ...rest } = stored;
      return value === byDefault ? rest : { ...rest, [id]: value };
    });
    const stored = this.stored();
    this.parent.settings.set(PREFERENCES_KEY, Object.keys(stored).length === 0 ? null : stored);
    this.applied(id, value);
  }

  /** Puts a switch back to its default. */
  reset(id: string): void {
    const preference = PreferencesFeature.find(id);
    if (preference?.kind.type === 'boolean') {
      this.set(id, preference.kind.default);
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
