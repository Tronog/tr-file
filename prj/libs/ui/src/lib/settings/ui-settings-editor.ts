import { Component, computed, input, output } from '@angular/core';
import { UiButton } from '../controls/ui-button';
import { UiSearchField } from '../controls/ui-search-field';
import { UiIcon } from '../icon/ui-icon';
import type {
  UiKeybindingRequest,
  UiSetting,
  UiSettingChange,
  UiSettingsEditorModel,
} from '../models/settings.model';
import { UiKeybindingsTable } from './ui-keybindings-table';

/**
 * The settings window (PRD 010), after VS Code's Settings editor: a search
 * box across the top, the sections down the left — *General*, *Appearance*,
 * *Keyboard Shortcuts* — and the section's page on the right.
 *
 * A settings page draws each setting the way VS Code does: `Category: Title`,
 * what it does, and its control — a checkbox, a drop-down, or a button for a
 * thing to do — with a bar beside the ones changed from their default and a
 * way to put them back. The Keyboard Shortcuts page is `UiKeybindingsTable`.
 *
 * Everything shown is the model's, already filtered by `query`; everything
 * done is reported. Meant to be the content of a large `UiModal`, whose close
 * button and `Escape` it relies on the host to wire to `close`.
 */
@Component({
  selector: 'ui-settings-editor',
  imports: [UiButton, UiIcon, UiKeybindingsTable, UiSearchField],
  templateUrl: './ui-settings-editor.html',
  styleUrl: './ui-settings-editor.scss',
})
export class UiSettingsEditor {
  readonly model = input.required<UiSettingsEditorModel>();

  /** A section was chosen in the table of contents. */
  readonly sectionSelect = output<string>();

  /** The search box changed. */
  readonly queryChange = output<string>();

  readonly settingChange = output<UiSettingChange>();

  /** A setting was put back to its default. */
  readonly settingReset = output<string>();

  /** An `action` setting's button was pressed. */
  readonly settingAction = output<string>();

  /** Something asked of a row of the Keyboard Shortcuts page; see `UiKeybindingsTable`. */
  readonly keybindingRequest = output<UiKeybindingRequest>();

  readonly keybindingRecord = output<string>();
  readonly keybindingAccept = output<void>();
  readonly keybindingCancel = output<void>();

  /** *Reset All Keybindings*. */
  readonly keybindingsReset = output<void>();

  /** The close button. */
  readonly close = output<void>();

  protected readonly activeSection = computed(() => {
    const model = this.model();
    return model.sections.find((section) => section.id === model.active) ?? model.sections[0];
  });

  protected readonly searchPlaceholder = computed(() =>
    this.model().page.kind === 'keybindings' ? 'Type to search in keybindings' : 'Search settings',
  );

  protected onCheckbox(setting: UiSetting, event: Event): void {
    this.settingChange.emit({ id: setting.id, value: (event.target as HTMLInputElement).checked });
  }

  protected onSelect(setting: UiSetting, event: Event): void {
    this.settingChange.emit({ id: setting.id, value: (event.target as HTMLSelectElement).value });
  }

  protected idOf(setting: UiSetting): string {
    return `setting-${setting.id.replace(/[^a-z0-9-]/gi, '-')}`;
  }
}
