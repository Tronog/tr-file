import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiActivityItem } from '../models/chrome.model';

/**
 * The 48px activity bar: primary view switchers at the top, secondary entries
 * (account, settings) pinned to the bottom by a flexible spacer.
 *
 * The active entry is marked with `aria-pressed` and gets VS Code's 2px left
 * indicator bar, drawn as a `::before` pseudo element.
 */
@Component({
  selector: 'ui-activity-bar',
  imports: [UiIcon],
  templateUrl: './ui-activity-bar.html',
  styleUrl: './ui-activity-bar.scss',
  host: {
    role: 'toolbar',
    'aria-orientation': 'vertical',
    'aria-label': 'Activity bar',
  },
})
export class UiActivityBar {
  readonly items = input.required<readonly UiActivityItem[]>();

  /** Entries pushed to the bottom of the bar. */
  readonly bottomItems = input<readonly UiActivityItem[]>([]);

  readonly select = output<string>();
}
