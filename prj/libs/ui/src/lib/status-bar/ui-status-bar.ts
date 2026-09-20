import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiStatusItem } from '../models/chrome.model';

/**
 * The 22px status bar: leading items (remote, branch, problems) and trailing
 * items (selection, sort, encoding) separated by a flexible spacer.
 *
 * An `accent` item renders on the accent background, matching VS Code's remote
 * indicator.
 */
@Component({
  selector: 'ui-status-bar',
  imports: [UiIcon],
  templateUrl: './ui-status-bar.html',
  styleUrl: './ui-status-bar.scss',
  host: {
    role: 'group',
    'aria-label': 'Status bar',
  },
})
export class UiStatusBar {
  readonly leadingItems = input<readonly UiStatusItem[]>([]);

  readonly trailingItems = input<readonly UiStatusItem[]>([]);

  readonly select = output<string>();
}
