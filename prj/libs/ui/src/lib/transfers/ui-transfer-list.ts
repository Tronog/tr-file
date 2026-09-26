import { Component, input, output } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiIcon } from '../icon/ui-icon';
import { UiProgress } from '../progress/ui-progress';
import type { UiTransfer } from '../models';

/**
 * The Transfers and Progress tabs of the bottom panel: one 26px row per
 * upload, download or file operation.
 *
 * The icon colour is per-row data (`iconColor`) rather than a tint token,
 * because the hue encodes the direction of the transfer, not a file type.
 */
@Component({
  selector: 'ui-transfer-list',
  imports: [UiIcon, UiIconButton, UiProgress],
  template: `
    @for (transfer of transfers(); track transfer.id) {
      <div class="transfer" role="listitem">
        <ui-icon [name]="transfer.icon" [style.color]="transfer.iconColor" />
        <span class="transfer-name" [attr.title]="transfer.detail ?? transfer.name">{{ transfer.name }}</span>
        <ui-progress [value]="transfer.progress" [label]="transfer.name" />
        <span class="transfer-stat">{{ transfer.statusLabel }}</span>
        <span class="transfer-action">
          @if (transfer.cancellable) {
            <ui-icon-button icon="x" [label]="'Cancel ' + transfer.name" (action)="cancel.emit(transfer.id)" />
          }
        </span>
      </div>
    }
  `,
  styleUrl: './ui-transfer-list.scss',
  host: {
    role: 'list',
  },
})
export class UiTransferList {
  readonly transfers = input.required<readonly UiTransfer[]>();

  /** The stop button of a `cancellable` row: its id. */
  readonly cancel = output<string>();
}
