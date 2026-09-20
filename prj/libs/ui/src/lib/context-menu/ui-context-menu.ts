import { Component, input, output } from '@angular/core';
import type { UiMenuItem } from '../models';

/**
 * The right-click menu, positioned absolutely at the pointer.
 *
 * Disabled rows keep their tab stop and carry `aria-disabled` rather than the
 * `disabled` attribute, so a keyboard user can read them; their clicks are
 * swallowed. `separatorBefore` draws a 1px divider above the row instead of
 * requiring separator entries in the data.
 */
@Component({
  selector: 'ui-context-menu',
  templateUrl: './ui-context-menu.html',
  styleUrl: './ui-context-menu.scss',
  host: {
    role: 'menu',
    '[attr.aria-label]': 'label()',
    '[style.left.px]': 'x()',
    '[style.top.px]': 'y()',
  },
})
export class UiContextMenu {
  readonly items = input.required<readonly UiMenuItem[]>();

  /** Distance from the positioned ancestor's left edge, in px. */
  readonly x = input<number>(0);

  /** Distance from the positioned ancestor's top edge, in px. */
  readonly y = input<number>(0);

  readonly label = input<string>('Context menu');

  readonly select = output<string>();

  protected onSelect(item: UiMenuItem): void {
    if (!item.disabled) {
      this.select.emit(item.id);
    }
  }
}
