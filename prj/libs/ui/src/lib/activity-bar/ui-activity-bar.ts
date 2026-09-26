import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiActivityItem, UiMenuAnchor } from '../models/chrome.model';

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

  /** A `hasMenu` item was pressed; opening (or closing) its menu is the app's call. */
  readonly menuOpen = output<UiMenuAnchor>();

  protected press(item: UiActivityItem, event: MouseEvent): void {
    if (!item.hasMenu) {
      this.select.emit(item.id);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuOpen.emit({ id: item.id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
}
