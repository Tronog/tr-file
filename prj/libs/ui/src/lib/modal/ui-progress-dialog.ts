import { Component, input, output } from '@angular/core';
import { UiButton } from '../controls/ui-button';
import { UiIcon } from '../icon/ui-icon';
import type { UiProgressDialogModel } from '../models';
import { UiProgress } from '../progress/ui-progress';

let nextId = 0;

/**
 * A running operation in a modal window (PRD 005, §1), to be put inside a
 * `UiModal`: its title, the entry it is on, a bar, and the counts.
 *
 * While it runs there are two ways out — *Run in Background*, which only
 * closes the window, and *Cancel*, which stops the operation — and once it
 * has ended, one: *Close*. Render-only, like `UiDialog`: it reports the
 * button and never closes itself.
 */
@Component({
  selector: 'ui-progress-dialog',
  imports: [UiButton, UiIcon, UiProgress],
  template: `
    <div class="message-row">
      @if (model().state === 'failed') {
        <ui-icon class="severity-error" name="alert-circle" size="lg" aria-hidden="true" />
      }
      <div class="message-body">
        <p class="message" [id]="id + '-title'">{{ model().title }}</p>
        <p class="current" [attr.title]="model().current">{{ model().current ?? ' ' }}</p>
        <ui-progress [value]="model().state === 'running' ? model().progress : 100" [label]="model().title" />
        <p class="status">{{ model().status }}</p>
        @if (model().error; as error) {
          <p class="error" role="alert">{{ error }}</p>
        }
      </div>
    </div>

    <div class="buttons">
      @if (model().state === 'running') {
        <button uiButton type="button" data-autofocus (click)="background.emit()">Run in Background</button>
        <button uiButton type="button" variant="secondary" [disabled]="model().cancelling === true" (click)="cancel.emit()">
          {{ model().cancelling ? 'Cancelling…' : 'Cancel' }}
        </button>
      } @else {
        <button uiButton type="button" data-autofocus (click)="close.emit()">Close</button>
      }
    </div>
  `,
  styleUrl: './ui-progress-dialog.scss',
})
export class UiProgressDialog {
  readonly model = input.required<UiProgressDialogModel>();

  /** Close the window; the operation carries on. */
  readonly background = output<void>();

  /** Stop the operation. */
  readonly cancel = output<void>();

  /** It has ended; close the window. */
  readonly close = output<void>();

  /** For `UiModal`'s `labelledBy`: `<id>-title`. */
  readonly id = `ui-progress-dialog-${(nextId += 1)}`;
}
