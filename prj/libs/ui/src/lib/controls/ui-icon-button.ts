import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconName } from '../models';

/**
 * A square, borderless icon button — the workbench's only button shape.
 *
 * `sm` (20x20) is the pane-header / toolbar size, `md` (30x26) the title-bar
 * chrome size. Icon-only by design, so `label` is required: it supplies both
 * the accessible name and the tooltip.
 */
@Component({
  selector: 'ui-icon-button',
  imports: [UiIcon],
  template: `
    <button
      type="button"
      class="btn"
      [disabled]="disabled()"
      [attr.aria-label]="label()"
      [attr.title]="label()"
      [attr.aria-pressed]="active() ? 'true' : null"
      (click)="action.emit()"
    >
      <ui-icon [name]="icon()" />
    </button>
  `,
  styleUrl: './ui-icon-button.scss',
  host: {
    '[class.is-active]': 'active()',
    '[class.size-md]': 'size() === "md"',
  },
})
export class UiIconButton {
  /** Symbol drawn inside the button. */
  readonly icon = input.required<UiIconName>();

  /** Accessible name — also the tooltip. */
  readonly label = input.required<string>();

  /** Toggle state; renders `aria-pressed` and the active background. */
  readonly active = input<boolean>(false);

  readonly disabled = input<boolean>(false);

  /** `sm` = 20x20 (toolbars), `md` = 30x26 (title bar chrome). */
  readonly size = input<'sm' | 'md'>('sm');

  readonly action = output<void>();
}
