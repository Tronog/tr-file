import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconAction, UiIconName } from '../models/icon.model';
import type { UiMenuBarItem, UiWindowControl } from '../models/chrome.model';

/**
 * The window title bar: menu bar on the left, command centre in the middle and
 * layout/chrome buttons on the right.
 *
 * The three regions are grid columns, so the command centre stays optically
 * centred however wide the menu or the action group grows.
 *
 * When the shell has taken the window's own decorations away (PRD 001, §8.2),
 * this bar *is* the title bar: `draggable` turns its empty space into the
 * region the OS moves the window by, `windowControls` puts minimise / maximise
 * / close at its end, and a double-click on that empty space reports itself so
 * the application can toggle maximise. All three are inputs rather than
 * behaviour, because a web page cannot move a window — only the desktop shell
 * can, and only it knows whether there is a window to move.
 */
@Component({
  selector: 'ui-title-bar',
  imports: [UiIcon],
  templateUrl: './ui-title-bar.html',
  styleUrl: './ui-title-bar.scss',
  host: {
    '[class.is-draggable]': 'draggable()',
    '[style.padding-left.px]': 'leadingInset() || null',
    '(dblclick)': 'onDoubleClick($event)',
  },
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

  /**
   * The window buttons, or empty where the window still has its own — a
   * browser tab, or a platform that draws them itself.
   */
  readonly windowControls = input<readonly UiWindowControl[]>([]);

  /**
   * Whether the bar's empty space drags the window. Only ever true inside a
   * frameless desktop window; in a browser it would do nothing.
   */
  readonly draggable = input<boolean>(false);

  /**
   * Blank space reserved at the leading edge, in pixels — room for window
   * buttons the platform draws over the bar itself, such as macOS's traffic
   * lights.
   */
  readonly leadingInset = input<number>(0);

  readonly menuSelect = output<string>();

  readonly commandSelect = output<void>();

  readonly actionSelect = output<string>();

  readonly windowControlSelect = output<string>();

  /** A double-click on the drag region; conventionally toggles maximise. */
  readonly dragAreaDoubleClick = output<void>();

  /**
   * Reports a double-click only when it landed on the bar itself.
   *
   * Without the guard, double-clicking a menu entry or the command centre
   * would also maximise the window, which is never what was meant.
   */
  protected onDoubleClick(event: MouseEvent): void {
    if (!this.draggable()) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('button, input, a, [role="button"]')) {
      return;
    }
    this.dragAreaDoubleClick.emit();
  }
}
