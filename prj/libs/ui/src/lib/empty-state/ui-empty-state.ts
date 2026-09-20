import { Component, input } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiEmptyStateModel } from '../models';

/**
 * The placeholder a group shows when it has nothing open.
 *
 * A centred column: an oversized dimmed icon, a title, an optional hint and an
 * optional list of keys rendered as `<kbd>` chips (the mockup's
 * "<kbd>Ctrl</kbd> <kbd>O</kbd> or drop a folder here" line).
 */
@Component({
  selector: 'ui-empty-state',
  imports: [UiIcon],
  template: `
    <ui-icon [name]="state().icon" size="xl" />
    <p class="title">{{ state().title }}</p>
    @if (state().hint; as hint) {
      <p class="hint">{{ hint }}</p>
    }
    @if (state().keys; as keys) {
      <p class="keys">
        @for (key of keys; track key) {
          <kbd>{{ key }}</kbd>
        }
      </p>
    }
  `,
  styleUrl: './ui-empty-state.scss',
})
export class UiEmptyState {
  readonly state = input.required<UiEmptyStateModel>();
}
