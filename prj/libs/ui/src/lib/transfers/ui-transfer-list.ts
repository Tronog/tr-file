import { Component, input } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UiProgress } from '../progress/ui-progress';
import type { UiTransfer } from '../models';

/**
 * The Transfers tab of the bottom panel: one 26px row per copy/move/upload.
 *
 * The icon colour is per-row data (`iconColor`) rather than a tint token,
 * because the hue encodes the direction of the transfer, not a file type.
 */
@Component({
  selector: 'ui-transfer-list',
  imports: [UiIcon, UiProgress],
  template: `
    @for (transfer of transfers(); track transfer.id) {
      <div class="transfer" role="listitem">
        <ui-icon [name]="transfer.icon" [style.color]="transfer.iconColor" />
        <span class="transfer-name">{{ transfer.name }}</span>
        <ui-progress [value]="transfer.progress" [label]="transfer.name" />
        <span class="transfer-stat">{{ transfer.statusLabel }}</span>
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
}
