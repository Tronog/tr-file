import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
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
 * upward from a button at the bottom of the window — or its bottom-right with
 * `'bottom-right'`, for one that opens upward and leftward, from a button at
 * the right edge (the activity bar, when the sides are swapped — PRD 010, §3). With `fixed` the point is
 * in viewport pixels; otherwise it is relative to the positioned ancestor.
 *
 * A `fixed` menu opening from its top-left corner stays on screen: one that
 * would run past the right or bottom edge — a right-click near the corner of
 * the window (PRD 003, §5) — is moved back just far enough, as a system menu
 * is.
 */
@Component({
  selector: 'ui-context-menu',
  imports: [UiIcon],
  templateUrl: './ui-context-menu.html',
  styleUrl: './ui-context-menu.scss',
  host: {
    role: 'menu',
    '[attr.aria-label]': 'label()',
    '[style.position]': 'fixed() ? "fixed" : null',
    '[style.left.px]': 'x() - shift().x',
    '[style.top.px]': 'y() - shift().y',
    '[class.from-bottom]': 'origin() !== "top-left"',
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
  readonly origin = input<'top-left' | 'bottom-left' | 'bottom-right'>('top-left');

  /** Position against the viewport rather than the nearest positioned ancestor. */
  readonly fixed = input<boolean>(false);

  readonly label = input<string>('Context menu');

  readonly select = output<string>();

  /** The menu wants to close; the reason says why. */
  readonly dismiss = output<UiMenuDismissReason>();

  /**
   * `←`/`→`: in a menu bar's menu, move to the menu beside it (PRD 008, §1).
   * Anywhere else nobody listens, and the keys do nothing.
   */
  readonly navigate = output<'previous' | 'next'>();

  /** Whether any row is a choice, so every row keeps room for the check mark. */
  protected readonly hasChecks = computed(() => this.items().some((item) => item.checked !== undefined));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly rows = viewChildren<ElementRef<HTMLButtonElement>>('row');

  /** Focus from before the menu opened, handed back when it closes by keyboard or choice. */
  private readonly previous: Element | null = document.activeElement;

  /** How far the menu was moved back to stay inside the viewport. */
  protected readonly shift = signal({ x: 0, y: 0 });

  constructor() {
    afterNextRender(() => {
      this.keepOnScreen();
      this.rows()[0]?.nativeElement.focus();
    });
  }

  /** Moves a `fixed`, top-left menu that overflows the viewport back inside it, with a 4px margin. */
  private keepOnScreen(): void {
    const rect = this.host.getBoundingClientRect();
    if (this.origin() === 'bottom-right') {
      // Its right edge at `x`: moved back by its own width, once it has one.
      this.shift.set({ x: rect.width, y: 0 });
      return;
    }
    if (!this.fixed() || this.origin() !== 'top-left') {
      return;
    }
    const margin = 4;
    const x = Math.max(0, Math.min(rect.right + margin - window.innerWidth, rect.left - margin));
    const y = Math.max(0, Math.min(rect.bottom + margin - window.innerHeight, rect.top - margin));
    if (x > 0 || y > 0) {
      this.shift.set({ x, y });
    }
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
      case 'ArrowLeft':
      case 'ArrowRight':
        this.navigate.emit(event.key === 'ArrowLeft' ? 'previous' : 'next');
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
