import { Component, input, model } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';

/**
 * The toolbar filter box: a 22px input on `--vsc-input-bg` with a leading
 * search icon.
 *
 * `focused` paints the accent border without the field actually holding focus,
 * so the static mockup states can be reproduced; real focus does the same via
 * `:focus-within`.
 */
@Component({
  selector: 'ui-search-field',
  imports: [UiIcon],
  template: `
    <ui-icon name="search" />
    <input
      type="search"
      class="field"
      [attr.aria-label]="label()"
      [placeholder]="placeholder()"
      [value]="value()"
      (input)="onInput($event)"
    />
  `,
  styleUrl: './ui-search-field.scss',
  host: {
    '[class.is-focused]': 'focused()',
  },
})
export class UiSearchField {
  readonly placeholder = input<string>('Filter files…');

  /** Accessible name of the input. */
  readonly label = input<string>('Filter');

  /** Renders the accent border for a statically focused mockup state. */
  readonly focused = input<boolean>(false);

  readonly value = model<string>('');

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
