import { Component, effect, inject, input, type Signal } from '@angular/core';
import { UiProgressDialog, type UiProgressDialogModel, UI_MODAL_REF, type UiModalRef } from '@tr-file/ui';

/**
 * A file operation's progress in a modal window (PRD 005, §1), opened by
 * `OperationsFeature`. It follows the job's view model and closes itself once
 * the job is done or cancelled; a failure stays open, to say why. Closing it —
 * *Run in Background*, `Escape` — leaves the job running, and the bottom
 * panel's Progress tab still shows it.
 */
@Component({
  selector: 'app-operation-progress-modal',
  imports: [UiProgressDialog],
  template: `
    @if (view()(); as model) {
      <ui-progress-dialog [model]="model" (background)="ref.close(null)" (cancel)="cancel()()" (close)="ref.close(null)" />
    }
  `,
})
export class OperationProgressModal {
  /** The job as the dialog shows it; `null` once it is gone. */
  readonly view = input.required<Signal<UiProgressDialogModel | null>>();

  readonly cancel = input.required<() => void>();

  protected readonly ref = inject<UiModalRef<null>>(UI_MODAL_REF);

  constructor() {
    effect(() => {
      const model = this.view()();
      if (model === null || model.state === 'done' || model.state === 'cancelled') {
        this.ref.close(null);
      }
    });
  }
}
