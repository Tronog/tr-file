import type { UiIconName } from './icon.model';

/**
 * The settings editor (PRD 010): VS Code's Settings and Keyboard Shortcuts,
 * as one window with a page per section. `UiSettingsEditor` draws what it is
 * handed and reports what is done; the settings themselves, their values and
 * the key bindings are the application's.
 */

/** A page of the editor, listed in its table of contents. */
export interface UiSettingsSection {
  readonly id: string;
  readonly label: string;
  readonly icon?: UiIconName;
}

/** An option of a `select` setting. */
export interface UiSettingOption {
  readonly value: string;
  readonly label: string;
}

/** How a setting is changed. */
export type UiSettingControl =
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'select'; readonly value: string; readonly options: readonly UiSettingOption[] }
  /** Not a value but a thing to do — *Reset Layout*. */
  | { readonly kind: 'action'; readonly label: string };

/** One setting, as VS Code draws it: `Category: Title`, a description, the control. */
export interface UiSetting {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly control: UiSettingControl;
  /** Set to something other than its default — marked, and offered a reset. */
  readonly modified?: boolean;
}

/** Settings under one heading. */
export interface UiSettingsGroup {
  readonly id: string;
  readonly title: string;
  readonly settings: readonly UiSetting[];
}

/** A setting changed; `value` is the control's new value. */
export interface UiSettingChange {
  readonly id: string;
  readonly value: boolean | string;
}

/** One key binding — or a command with none — on the Keyboard Shortcuts page. */
export interface UiKeybindingRow {
  readonly id: string;
  /** The command's id, shown under its name. */
  readonly command: string;
  readonly category: string;
  readonly label: string;
  /** The chord, as `chordOf` writes it; `null` for a command bound to nothing. */
  readonly key: string | null;
  /** Where the key applies, in words: `Anywhere`, `In a panel`, `On a row`. */
  readonly when: string;
  readonly source: 'Default' | 'User';
  /** The user changed this command's keys, so it can be reset. */
  readonly modified?: boolean;
}

/** A key being recorded for a row: a new key for it (`change`), or one more (`add`). */
export interface UiKeybindingRecording {
  readonly rowId: string;
  readonly mode: 'change' | 'add';
  /** The chord pressed so far; `null` until one is. */
  readonly key: string | null;
  /** The names of the other commands that chord already runs there. */
  readonly conflicts: readonly string[];
}

/** What is asked of a row of the Keyboard Shortcuts page. */
export interface UiKeybindingRequest {
  readonly rowId: string;
  readonly action: 'change' | 'add' | 'remove' | 'reset';
}

/** What the editor's right-hand side shows. */
export type UiSettingsPage =
  | {
      readonly kind: 'settings';
      readonly groups: readonly UiSettingsGroup[];
    }
  | {
      readonly kind: 'keybindings';
      readonly rows: readonly UiKeybindingRow[];
      readonly recording: UiKeybindingRecording | null;
      /** Whether any key was changed, so *Reset All* has something to do. */
      readonly modified: boolean;
    };

export interface UiSettingsEditorModel {
  readonly sections: readonly UiSettingsSection[];
  /** The section shown. */
  readonly active: string;
  /** What the search box holds; the page is already filtered by it. */
  readonly query: string;
  readonly page: UiSettingsPage;
}
