import { Component, computed, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconViewItem } from '../models';

/**
 * The "large icons" view of a directory: an auto-filling grid of 96px tiles.
 *
 * Exposed as a listbox rather than a grid because selection, not spatial
 * position, is what the control is about.
 */
@Component({
  selector: 'ui-icon-view',
  imports: [UiIcon],
  template: `
    @for (item of items(); track item.id) {
      <button
        type="button"
        class="item"
        role="option"
        [class.is-selected]="item.selected"
        [attr.aria-selected]="item.selected ? 'true' : 'false'"
        [attr.tabindex]="item.id === focusId() ? 0 : -1"
        [attr.title]="item.label"
        (click)="select.emit(item.id)"
        (dblclick)="activate.emit(item.id)"
      >
        <ui-icon [name]="item.icon" [tint]="item.tint" size="xl" />
        <span class="item-label">{{ item.label }}</span>
      </button>
    }
  `,
  styleUrl: './ui-icon-view.scss',
  host: {
    role: 'listbox',
    '[attr.aria-label]': 'label()',
  },
})
export class UiIconView {
  readonly items = input.required<readonly UiIconViewItem[]>();

  /** Accessible name of the listbox. */
  readonly label = input<string>('Files');

  readonly activate = output<string>();
  readonly select = output<string>();

  /** The one tile that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const items = this.items();
    return (items.find((item) => item.selected) ?? items[0])?.id ?? null;
  });
}
