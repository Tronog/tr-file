import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconAction } from '../models';

/**
 * A workbench side bar (Explorer on the left, Details on the right).
 *
 * Draws the 35px uppercase title row with its optional action buttons and
 * projects the panes below it. The border sits on the side that faces the
 * editor, so `side` is a purely visual choice — placement is the caller's job.
 */
@Component({
  selector: 'ui-sidebar',
  templateUrl: './ui-sidebar.html',
  styleUrl: './ui-sidebar.scss',
  imports: [UiIcon],
  host: {
    class: 'ui-sidebar',
    role: 'complementary',
    '[attr.aria-label]': 'title()',
    '[class.side-left]': "side() === 'left'",
    '[class.side-right]': "side() === 'right'",
  },
})
export class UiSidebar {
  /** Title shown in the header row; also names the landmark. */
  readonly title = input.required<string>();

  /** Which edge the sidebar sits on — decides where the border is drawn. */
  readonly side = input<'left' | 'right'>('left');

  /** Icon buttons rendered at the right of the title row. */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Emits the `id` of the clicked title-row action. */
  readonly actionSelect = output<string>();
}
