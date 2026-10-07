import { NgComponentOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { UiDialog } from './ui-dialog';
import { UiModal } from './ui-modal';
import { UiModalService } from './ui-modal.service';

/**
 * Draws `UiModalService`'s windows (PRD 002, §3). Rendered once, at the root,
 * after everything else; only the top window is interactive — the ones under
 * it are `inert`, as the rest of the page is while any is open.
 */
@Component({
  selector: 'ui-modal-host',
  imports: [NgComponentOutlet, UiDialog, UiModal],
  template: `
    @for (entry of modal.stack(); track entry.id; let top = $last) {
      @if (entry.kind === 'dialog') {
        <ui-modal
          [attr.inert]="top ? null : ''"
          [labelledBy]="'modal-' + entry.id + '-message'"
          [describedBy]="entry.model().detail ? 'modal-' + entry.id + '-detail' : null"
          [dismissible]="entry.dismissible"
          (dismiss)="modal.dismiss(entry.id)"
        >
          <ui-dialog
            [idPrefix]="'modal-' + entry.id"
            [dialog]="entry.model()"
            [dismissible]="entry.dismissible"
            (choose)="modal.choose(entry.id, $event)"
            (dismiss)="modal.dismiss(entry.id)"
            (valueChange)="modal.edit(entry.id, $event)"
          />
        </ui-modal>
      } @else {
        <ui-modal
          [attr.inert]="top ? null : ''"
          [label]="entry.label"
          [dismissible]="entry.dismissible"
          [size]="entry.size"
          (dismiss)="modal.dismiss(entry.id)"
        >
          <ng-container *ngComponentOutlet="entry.component; inputs: entry.inputs; injector: entry.injector" />
        </ui-modal>
      }
    }
  `,
})
export class UiModalHost {
  protected readonly modal = inject(UiModalService);
}
