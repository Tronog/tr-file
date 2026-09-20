import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconAction, UiIconName } from '../models/icon.model';
import type { UiMenuBarItem } from '../models/chrome.model';

/**
 * The window title bar: menu bar on the left, command centre in the middle and
 * layout/chrome buttons on the right.
 *
 * The three regions are grid columns, so the command centre stays optically
 * centred however wide the menu or the action group grows.
 */
@Component({
  selector: 'ui-title-bar',
  imports: [UiIcon],
  templateUrl: './ui-title-bar.html',
  styleUrl: './ui-title-bar.scss',
})
export class UiTitleBar {
  readonly menuItems = input.required<readonly UiMenuBarItem[]>();

  /** Icon drawn as the window/product mark before the first menu entry. */
  readonly brandIcon = input<UiIconName>('folder-open');

  /** Text of the command centre; it is hidden when empty. */
  readonly commandLabel = input<string>('');

  /** Keyboard hint rendered as one `<kbd>` per key, e.g. `['Ctrl', 'P']`. */
  readonly commandKeys = input<readonly string[]>([]);

  readonly actions = input<readonly UiIconAction[]>([]);

  readonly menuSelect = output<string>();

  readonly commandSelect = output<void>();

  readonly actionSelect = output<string>();
}
