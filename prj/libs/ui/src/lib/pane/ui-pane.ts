import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconAction, UiIconActionAt } from '../models';

/**
 * A collapsible section inside a side bar (Explorer's "tr-file", Details'
 * "Properties", …).
 *
 * The body is removed from the DOM while collapsed, so `aria-controls` is only
 * emitted when there is something to point at. `grow` hands the pane the
 * sidebar's leftover height and makes its body the scroll container.
 */
@Component({
  selector: 'ui-pane',
  templateUrl: './ui-pane.html',
  styleUrl: './ui-pane.scss',
  imports: [UiIcon],
  host: {
    class: 'ui-pane',
    '[class.is-grow]': 'grow()',
    '[class.is-collapsed]': '!expanded()',
  },
})
export class UiPane {
  /** Uppercase header label. */
  readonly title = input.required<string>();

  /** Whether the body is rendered. */
  readonly expanded = input<boolean>(true);

  /** Icon buttons rendered at the right of the header. */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Take the remaining sidebar space and scroll the body. */
  readonly grow = input<boolean>(false);

  /** The header was clicked; the caller flips `expanded`. */
  readonly toggle = output<void>();

  /** Emits the `id` of the clicked header action. */
  readonly actionSelect = output<string>();

  /** The same click, with where the button is — for a `…` that opens a menu beside it. */
  readonly actionAt = output<UiIconActionAt>();

  /** Instance counter — a unique body id without pulling in a service. */
  private static nextId = 0;

  protected readonly bodyId = `ui-pane-${UiPane.nextId++}`;

  protected select(id: string, event: MouseEvent): void {
    this.actionSelect.emit(id);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.actionAt.emit({ id, x: rect.left, y: rect.bottom });
  }
}
