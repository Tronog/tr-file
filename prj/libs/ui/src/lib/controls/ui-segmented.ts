import { Component, input, model } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconName } from '../models';

/** One choice of a `UiSegmented` control. */
export interface UiSegmentedOption {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
}

/**
 * A joined row of icon-only toggles — the group toolbar's list/grid switch.
 *
 * Exposed as a radio group: exactly one option is selected at a time and the
 * selection is the two-way `value` model.
 */
@Component({
  selector: 'ui-segmented',
  imports: [UiIcon],
  template: `
    @for (option of options(); track option.id) {
      <button
        type="button"
        class="seg-item"
        role="radio"
        [class.is-active]="option.id === value()"
        [attr.aria-checked]="option.id === value()"
        [attr.aria-label]="option.label"
        [attr.title]="option.label"
        (click)="value.set(option.id)"
      >
        <ui-icon [name]="option.icon" />
      </button>
    }
  `,
  styleUrl: './ui-segmented.scss',
  host: {
    role: 'radiogroup',
    '[attr.aria-label]': 'label()',
  },
})
export class UiSegmented {
  readonly options = input.required<readonly UiSegmentedOption[]>();

  /** Accessible name of the group. */
  readonly label = input<string>('View');

  /** Id of the selected option. */
  readonly value = model.required<string>();
}
