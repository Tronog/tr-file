import { Component, ElementRef, afterRenderEffect, input, model, viewChild } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';

/**
 * The toolbar filter box: a 22px input on `--vsc-input-bg` with a leading
 * search icon.
 *
 * `focused` paints the accent border without the field actually holding focus,
 * so the static mockup states can be reproduced; real focus does the same via
 * `:focus-within`.
 *
 * `focusToken` asks for real focus, the way `UiPanelGroup.focusBody` does: any
 * change is one request, answered once the field has rendered — which is how
 * the application puts the keyboard in the box (`Ctrl`+`F`, the Search view)
 * without reaching into the DOM. `focus()` does the same for a parent
 * component holding a reference.
 */
@Component({
  selector: 'ui-search-field',
  imports: [UiIcon],
  template: `
    <ui-icon name="search" />
    <input
      #field
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

  /** Bump to move focus into the field; `0` never asks. */
  readonly focusToken = input<number>(0);

  readonly value = model<string>('');

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  private seenToken = 0;

  constructor() {
    afterRenderEffect(() => {
      const token = this.focusToken();
      if (token !== this.seenToken) {
        this.seenToken = token;
        if (token > 0) {
          this.focus();
        }
      }
    });
  }

  /** Puts the keyboard in the field, with what it holds selected. */
  focus(): void {
    const field = this.field().nativeElement;
    field.focus();
    field.select();
  }

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
