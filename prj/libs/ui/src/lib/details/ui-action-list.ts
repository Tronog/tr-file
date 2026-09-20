import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiActionListItem } from '../models';

/** The "Open with" list of the details side bar: 26px rows of icon, label and a dim tag. */
@Component({
  selector: 'ui-action-list',
  templateUrl: './ui-action-list.html',
  styleUrl: './ui-action-list.scss',
  imports: [UiIcon],
  host: { class: 'ui-action-list' },
})
export class UiActionList {
  readonly items = input.required<readonly UiActionListItem[]>();

  /** Emits the `id` of the chosen row. */
  readonly select = output<string>();
}
