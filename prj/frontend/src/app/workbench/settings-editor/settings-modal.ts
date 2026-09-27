import { Component, inject, input } from '@angular/core';
import { UiSettingsEditor } from '@tr-file/ui';
import { MODAL_REF, type ModalRef } from '../../modal/modal-ref';
import type { SettingsEditorFeature } from '../features/settings-editor.feature';

/**
 * The settings window (PRD 010): `UiSettingsEditor` in a large modal window,
 * opened by `SettingsEditorFeature`, whose model it draws and to which it
 * reports everything done in it. The close button closes it, as `Escape` does.
 */
@Component({
  selector: 'app-settings-modal',
  imports: [UiSettingsEditor],
  template: `
    @let feature = editor();
    <ui-settings-editor
      [model]="feature.model()"
      (sectionSelect)="feature.selectSection($event)"
      (queryChange)="feature.setQuery($event)"
      (settingChange)="feature.changeSetting($event)"
      (settingReset)="feature.resetSetting($event)"
      (settingAction)="feature.runSetting($event)"
      (keybindingRequest)="feature.requestKeybinding($event)"
      (keybindingRecord)="feature.recordKey($event)"
      (keybindingAccept)="feature.acceptKey()"
      (keybindingCancel)="feature.cancelRecording()"
      (keybindingsReset)="feature.resetAllKeybindings()"
      (close)="ref.close(null)"
    />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
  `,
})
export class SettingsModal {
  readonly editor = input.required<SettingsEditorFeature>();

  protected readonly ref = inject<ModalRef<null>>(MODAL_REF);
}
