import { computed, signal } from '@angular/core';
import type { UiKeyContext } from '../../keyboard/keymap';
import type {
  UiKeybindingRecording,
  UiKeybindingRequest,
  UiKeybindingRow,
  UiSetting,
  UiSettingChange,
  UiSettingsEditorModel,
  UiSettingsGroup,
  UiSettingsSection,
} from '../../models/settings.model';
import { UiSettingsModal } from '../ui-settings-modal';
import type { UiPreference } from '../ui-workbench.config';
import type { UiWorkbenchService } from '../ui-workbench.service';
import type { UiKeybindingEntry } from './ui-keybindings.feature';

/** The pages of settings, unless the configuration has its own (`settingsSections`). */
const SETTINGS_SECTIONS: readonly UiSettingsSection[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
];

/** The last page, always: every key (PRD 010, §2). */
const KEYBOARD_SHORTCUTS: UiSettingsSection = { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts', icon: 'keyboard' };

/** Where a key applies, as the Keyboard Shortcuts page says it. */
const WHEN_LABELS: Readonly<Partial<Record<UiKeyContext, string>>> = {
  window: 'Anywhere',
  panel: 'In a panel',
  list: 'On a row',
  image: 'In the image viewer',
};

/**
 * The settings window (PRD 010): what it shows and what is done in it.
 *
 * The pages of settings list the configuration's `preferences`, their values
 * from `UiPreferencesFeature`; *Keyboard Shortcuts* lists
 * `UiKeybindingsFeature`'s table, and records a key for a row: the next key
 * pressed, shown with the commands it already runs, then kept on `Enter` or
 * dropped on `Escape`. The search box filters the page shown — the settings
 * of every page at once, the way VS Code searches every setting.
 *
 * `UiSettingsModal` puts `UiSettingsEditor` in a large modal window; this
 * feature is its model.
 */
export class UiSettingsEditorFeature {
  /** The window's pages: the configuration's pages of settings, then *Keyboard Shortcuts*. */
  readonly sections: readonly UiSettingsSection[];

  private readonly section = signal<string>('general');
  private readonly query = signal('');
  private readonly recording = signal<{ readonly rowId: string; readonly mode: 'change' | 'add'; readonly key: string | null } | null>(null);
  private readonly opened = signal(false);

  constructor(protected readonly parent: UiWorkbenchService) {
    this.sections = [...(parent.config.settingsSections ?? SETTINGS_SECTIONS), KEYBOARD_SHORTCUTS];
    this.section.set(this.sections[0]?.id ?? KEYBOARD_SHORTCUTS.id);
  }

  readonly isOpen = this.opened.asReadonly();

  /** Opens the window at `section` (the first page by default) — or, when it is open, turns to it. */
  open(section: string = this.sections[0]?.id ?? KEYBOARD_SHORTCUTS.id): void {
    this.selectSection(section);
    if (this.opened()) {
      return;
    }
    this.opened.set(true);
    void this.parent.modal.open(UiSettingsModal, { label: 'Settings', size: 'large', inputs: { editor: this } }).then(() => {
      this.opened.set(false);
      this.recording.set(null);
      this.query.set('');
    });
  }

  selectSection(section: string): void {
    if (this.sections.some((candidate) => candidate.id === section) && section !== this.section()) {
      this.section.set(section);
      this.query.set('');
      this.recording.set(null);
    }
  }

  setQuery(text: string): void {
    this.query.set(text);
  }

  /* -- settings ------------------------------------------------------------- */

  changeSetting(change: UiSettingChange): void {
    if (typeof change.value === 'boolean') {
      this.parent.preferencesFt.set(change.id, change.value);
    } else {
      this.parent.preferencesFt.choose(change.id, change.value);
    }
  }

  resetSetting(id: string): void {
    this.parent.preferencesFt.reset(id);
  }

  runSetting(id: string): void {
    this.parent.preferencesFt.run(id);
  }

  /* -- keyboard shortcuts --------------------------------------------------- */

  /** A row's pencil, `Enter`, or double click; its plus; its remove and reset buttons. */
  requestKeybinding(request: UiKeybindingRequest): void {
    const entry = this.entryOf(request.rowId);
    if (entry === undefined) {
      return;
    }
    const keys = this.parent.keybindingsFt;
    switch (request.action) {
      case 'change':
        // A command bound to nothing has nothing to change: it gets its first key.
        this.recording.set({ rowId: entry.id, mode: entry.binding === null ? 'add' : 'change', key: null });
        break;
      case 'add':
        this.recording.set({ rowId: entry.id, mode: 'add', key: null });
        break;
      case 'remove':
        if (entry.binding !== null) {
          keys.remove(entry.binding);
        }
        break;
      case 'reset':
        keys.reset(entry.command);
        break;
    }
  }

  /** A key pressed while recording. */
  recordKey(key: string): void {
    this.recording.update((recording) => (recording === null ? null : { ...recording, key }));
  }

  /** `Enter` while recording: the key is kept. */
  acceptKey(): void {
    const recording = this.recording();
    const entry = recording === null ? undefined : this.entryOf(recording.rowId);
    this.recording.set(null);
    if (recording?.key == null || entry === undefined) {
      return;
    }
    const keys = this.parent.keybindingsFt;
    if (recording.mode === 'change' && entry.binding !== null) {
      keys.change(entry.binding, recording.key);
    } else {
      keys.add(entry.command, recording.key, entry.binding?.when);
    }
  }

  cancelRecording(): void {
    this.recording.set(null);
  }

  resetAllKeybindings(): void {
    this.parent.keybindingsFt.resetAll();
  }

  /* -- the model -------------------------------------------------------------- */

  readonly model = computed<UiSettingsEditorModel>(() => {
    const section = this.section();
    return {
      sections: this.sections,
      active: section,
      query: this.query(),
      page:
        section === KEYBOARD_SHORTCUTS.id
          ? {
              kind: 'keybindings',
              rows: this.keybindingRows(),
              recording: this.recordingModel(),
              modified: this.parent.keybindingsFt.entries().some((entry) => entry.modified),
            }
          : { kind: 'settings', groups: this.settingGroups(section) },
    };
  });

  /** A page's settings under their headings — or, while searching, every match, page by page. */
  private settingGroups(section: string): readonly UiSettingsGroup[] {
    const words = UiSettingsEditorFeature.words(this.query());
    const shown = this.parent.preferencesFt.all.filter((preference) =>
      words.length === 0
        ? preference.section === section
        : UiSettingsEditorFeature.matches(`${preference.category} ${preference.title} ${preference.description} ${preference.id}`, words),
    );
    const groups: UiSettingsGroup[] = [];
    for (const preference of shown) {
      const title = words.length === 0 ? preference.group : `${this.sections.find((candidate) => candidate.id === preference.section)?.label} › ${preference.group}`;
      const id = `${preference.section}-${preference.group}`.toLowerCase();
      const group = groups.find((candidate) => candidate.id === id);
      const setting = this.settingOf(preference);
      if (group === undefined) {
        groups.push({ id, title, settings: [setting] });
      } else {
        groups[groups.indexOf(group)] = { ...group, settings: [...group.settings, setting] };
      }
    }
    return groups;
  }

  private settingOf(preference: UiPreference): UiSetting {
    const preferences = this.parent.preferencesFt;
    const { kind } = preference;
    return {
      id: preference.id,
      category: preference.category,
      title: preference.title,
      description: preference.description,
      control:
        kind.type === 'boolean'
          ? { kind: 'boolean', value: preferences.value(preference.id) }
          : kind.type === 'choice'
            ? { kind: 'select', value: preferences.choice(preference.id), options: kind.options }
            : { kind: 'action', label: kind.label },
      ...(preferences.isModified(preference.id) ? { modified: true } : {}),
    };
  }

  /** The rows, sorted by what they are called, and filtered by the search box. */
  private readonly keybindingRows = computed<readonly UiKeybindingRow[]>(() => {
    const words = UiSettingsEditorFeature.words(this.query());
    return [...this.parent.keybindingsFt.entries()]
      .filter((entry) => UiSettingsEditorFeature.matches(`${entry.category} ${entry.label} ${entry.command} ${entry.binding?.key ?? ''} ${entry.source}`, words))
      .sort((a, b) => `${a.category}: ${a.label}`.localeCompare(`${b.category}: ${b.label}`) || (a.binding === null ? 1 : 0) - (b.binding === null ? 1 : 0))
      .map((entry) => ({
        id: entry.id,
        command: entry.command,
        category: entry.category,
        label: entry.label,
        key: entry.binding?.key ?? null,
        when: entry.binding === null ? '' : (WHEN_LABELS[entry.binding.when] ?? entry.binding.when),
        source: entry.source,
        ...(entry.modified ? { modified: true } : {}),
      }));
  });

  private recordingModel(): UiKeybindingRecording | null {
    const recording = this.recording();
    const entry = recording === null ? undefined : this.entryOf(recording.rowId);
    if (recording === null || entry === undefined) {
      return null;
    }
    const keys = this.parent.keybindingsFt;
    const when = entry.binding?.when ?? keys.contextOf(entry.command);
    const conflicts =
      recording.key === null
        ? []
        : keys.conflicts(recording.key, when, entry.command).map((command) => {
            const { category, label } = keys.describe(command);
            return `${category}: ${label}`;
          });
    return { rowId: recording.rowId, mode: recording.mode, key: recording.key, conflicts };
  }

  private entryOf(rowId: string): UiKeybindingEntry | undefined {
    return this.parent.keybindingsFt.entries().find((entry) => entry.id === rowId);
  }

  private static words(query: string): readonly string[] {
    return query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  }

  private static matches(text: string, words: readonly string[]): boolean {
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
  }
}
