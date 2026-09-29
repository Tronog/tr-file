import { Component, ElementRef, computed, input, output, viewChildren } from '@angular/core';
import { UiContextMenu } from '../context-menu/ui-context-menu';
import { UiIcon } from '../icon/ui-icon';
import type { UiIconAction, UiIconName } from '../models/icon.model';
import type { UiMenuBarItem, UiMenuBarSelection, UiTitleBarUpgrade, UiWindowControl } from '../models/chrome.model';

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
  imports: [UiIcon, UiContextMenu],
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
   * A newer version of the application is there (PRD 001, §8.6): a blue
   * button right of the command palette box, or nothing when `null`.
   */
  readonly upgrade = input<UiTitleBarUpgrade | null>(null);

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

  /**
   * Which menu should be open: a title was pressed, hovered while another
   * menu was open, or reached with `←`/`→` — or `null` to close it. The
   * application sets `open` on the item to follow (PRD 008, §1).
   */
  readonly menuOpenChange = output<string | null>();

  /** An entry of an open menu was chosen. */
  readonly menuItemSelect = output<UiMenuBarSelection>();

  readonly commandSelect = output<void>();

  readonly actionSelect = output<string>();

  /** The *Upgrade* button was pressed. */
  readonly upgradeSelect = output<void>();

  readonly windowControlSelect = output<string>();

  /** A double-click on the drag region; conventionally toggles maximise. */
  readonly dragAreaDoubleClick = output<void>();

  /**
   * Reports a double-click only when it landed on the bar itself.
   *
   * Without the guard, double-clicking a menu entry or the command centre
   * would also maximise the window, which is never what was meant.
   */
  private readonly menuButtons = viewChildren<ElementRef<HTMLButtonElement>>('menuButton');

  /**
   * Set while a click on a title is being handled, so the open menu's "a
   * click elsewhere" does not close the menu that click just opened.
   */
  private switching = false;

  /** The open menu and where it goes: under its title, left edges aligned. */
  protected readonly openMenu = computed(() => {
    const item = this.menuItems().find((candidate) => candidate.open);
    if (item === undefined) {
      return null;
    }
    const button = this.menuButtons().find((candidate) => candidate.nativeElement.dataset['menuId'] === item.id);
    const rect = button?.nativeElement.getBoundingClientRect();
    return { item, x: rect?.left ?? 0, y: rect?.bottom ?? 0 };
  });

  /** A title opens its menu, or closes it when it is the open one. */
  protected onMenuClick(item: UiMenuBarItem): void {
    this.holdDismiss();
    this.menuOpenChange.emit(item.open ? null : item.id);
  }

  /** With a menu open, pointing at another title opens that one instead, as in VS Code. */
  protected onMenuHover(item: UiMenuBarItem): void {
    if (!item.open && this.menuItems().some((candidate) => candidate.open)) {
      // Focus goes to the title first, so the menu that opens hands it back there.
      this.menuButtons()
        .find((button) => button.nativeElement.dataset['menuId'] === item.id)
        ?.nativeElement.focus();
      this.menuOpenChange.emit(item.id);
    }
  }

  /** On a title: `←`/`→` move along the bar, `↓` opens the menu. */
  protected onMenuKeydown(event: KeyboardEvent, index: number): void {
    const items = this.menuItems();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.menuOpenChange.emit(items[index]?.id ?? null);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
      if (next !== undefined) {
        this.menuButtons()[items.indexOf(next)]?.nativeElement.focus();
        if (items.some((candidate) => candidate.open)) {
          this.menuOpenChange.emit(next.id);
        }
      }
    }
  }

  /**
   * `←`/`→` inside an open menu: the menu beside it opens. Its title takes
   * focus first, so the next menu hands focus back to it when it closes.
   */
  protected step(fromId: string, delta: 1 | -1): void {
    const items = this.menuItems();
    const index = items.findIndex((item) => item.id === fromId);
    const next = items[(index + delta + items.length) % items.length];
    if (next === undefined) {
      return;
    }
    this.menuButtons()[items.indexOf(next)]?.nativeElement.focus();
    this.menuOpenChange.emit(next.id);
  }

  protected onMenuDismiss(): void {
    if (!this.switching) {
      this.menuOpenChange.emit(null);
    }
  }

  private holdDismiss(): void {
    this.switching = true;
    queueMicrotask(() => (this.switching = false));
  }

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
