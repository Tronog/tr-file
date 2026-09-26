import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChildren,
} from '@angular/core';
import type { UiMenuItem } from '../models';

/** Why a menu asks to close. */
export type UiMenuDismissReason = 'escape' | 'tab' | 'outside' | 'blur';

/**
 * A menu, VS Code style — the right-click menu, and the menus buttons open
 * (the activity bar's Manage gear; PRD 007, §1).
 *
 * Disabled rows keep their place in the keyboard order and carry
 * `aria-disabled` rather than the `disabled` attribute, so a keyboard user can
 * read them; choosing one does nothing. `separatorBefore` draws a 1px divider
 * above the row instead of requiring separator entries in the data.
 *
 * It behaves as a menu has to: it takes focus when it opens, `↑`/`↓` move
 * (wrapping), `Home`/`End` jump, `Enter`/`Space` choose. It asks to close —
 * `dismiss`, with the reason — on `Escape`, on `Tab`, on a click anywhere
 * else, and when the window loses focus or changes size. After `Escape` or a
 * choice, focus goes back to wherever it was when the menu opened: the button
 * that opened it. Opening and closing are the application's; the menu only
 * asks.
 *
 * `(x, y)` is where the menu's corner goes: its top-left corner by default,
 * or its bottom-left with `origin: 'bottom-left'`, for a menu that opens
 * upward from a button at the bottom of the window. With `fixed` the point is
 * in viewport pixels; otherwise it is relative to the positioned ancestor.
 */
@Component({
  selector: 'ui-context-menu',
  templateUrl: './ui-context-menu.html',
  styleUrl: './ui-context-menu.scss',
  host: {
    role: 'menu',
    '[attr.aria-label]': 'label()',
    '[style.position]': 'fixed() ? "fixed" : null',
    '[style.left.px]': 'x()',
    '[style.top.px]': 'y()',
    '[class.from-bottom]': 'origin() === "bottom-left"',
    '(keydown)': 'onKeydown($event)',
    '(document:click)': 'onDocumentClick($event)',
    '(window:blur)': 'dismiss.emit("blur")',
    '(window:resize)': 'dismiss.emit("blur")',
  },
})
export class UiContextMenu {
  readonly items = input.required<readonly UiMenuItem[]>();

  /** Distance from the left edge — of the viewport when `fixed`, else of the positioned ancestor. */
  readonly x = input<number>(0);

  /** Distance from the top edge, likewise. */
  readonly y = input<number>(0);

  /** Which corner of the menu `(x, y)` places. */
  readonly origin = input<'top-left' | 'bottom-left'>('top-left');

  /** Position against the viewport rather than the nearest positioned ancestor. */
  readonly fixed = input<boolean>(false);

  readonly label = input<string>('Context menu');

  readonly select = output<string>();

  /** The menu wants to close; the reason says why. */
  readonly dismiss = output<UiMenuDismissReason>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly rows = viewChildren<ElementRef<HTMLButtonElement>>('row');

  /** Focus from before the menu opened, handed back when it closes by keyboard or choice. */
  private readonly previous: Element | null = document.activeElement;

  constructor() {
    afterNextRender(() => this.rows()[0]?.nativeElement.focus());
  }

  protected onSelect(item: UiMenuItem): void {
    if (item.disabled) {
      return;
    }
    this.restoreFocus();
    this.select.emit(item.id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const rows = this.rows().map((row) => row.nativeElement);
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        rows[(current + 1) % rows.length]?.focus();
        break;
      case 'ArrowUp':
        rows[(current - 1 + rows.length) % rows.length]?.focus();
        break;
      case 'Home':
        rows[0]?.focus();
        break;
      case 'End':
        rows.at(-1)?.focus();
        break;
      case 'Escape':
        event.stopPropagation();
        this.restoreFocus();
        this.dismiss.emit('escape');
        break;
      case 'Tab':
        // Focus moves on as `Tab` would take it; the menu just gets out of the way.
        this.dismiss.emit('tab');
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  /**
   * A click anywhere but in the menu closes it. A `click` rather than a
   * press, so the button that opened the menu can close it again: its own
   * handler runs first and the menu is gone before this one would.
   */
  protected onDocumentClick(event: MouseEvent): void {
    if (event.target instanceof Node && !this.host.contains(event.target)) {
      this.dismiss.emit('outside');
    }
  }

  private restoreFocus(): void {
    if (this.previous instanceof HTMLElement && this.previous.isConnected) {
      this.previous.focus();
    }
  }
}
