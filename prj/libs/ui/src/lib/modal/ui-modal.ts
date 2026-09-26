import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** What can hold focus inside a modal window. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal window, the way VS Code has them (PRD 002, §3): the workbench
 * dimmed behind it, the window centred over it, and the keyboard kept inside
 * until it closes.
 *
 * Content-agnostic — a message dialog (`UiDialog`), a form, anything is
 * projected into it. What the frame does is the part every modal needs:
 *
 * - **focus in**: the element marked `data-autofocus`, else the first thing
 *   that can take focus, else the window itself, once it has rendered;
 * - **focus kept**: `Tab` and `Shift`+`Tab` wrap within the window;
 * - **focus back**: when the window goes, focus returns to whatever had it
 *   before, if that is still on the page;
 * - **`Escape`** asks to `dismiss` — when `dismissible`;
 * - **a click outside** does not close it: as in VS Code, the window shakes,
 *   to say that it is waiting for an answer.
 *
 * Only the top window of a stack should be interactive; making the rest of
 * the page `inert` while one is open is the host's job, since the library
 * does not own the page.
 */
@Component({
  selector: 'ui-modal',
  template: `
    <div class="backdrop" aria-hidden="true" (pointerdown)="onBackdropPress($event)"></div>
    <div
      #window
      class="window"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-label]="labelledBy() ? null : label()"
      [class.is-shaking]="shaking()"
      (keydown)="onKeydown($event)"
      (animationend)="shaking.set(false)"
    >
      <ng-content />
    </div>
  `,
  styleUrl: './ui-modal.scss',
  host: { class: 'ui-modal' },
})
export class UiModal {
  /** Accessible name, when nothing in the content names the window. */
  readonly label = input<string>('Dialog');

  /** Id of the element that names the window — a dialog's message. */
  readonly labelledBy = input<string | null>(null);

  /** Id of the element that describes it — a dialog's detail. */
  readonly describedBy = input<string | null>(null);

  /** Whether `Escape` may close it. A window that must be answered shakes instead. */
  readonly dismissible = input<boolean>(true);

  /** `Escape` was pressed on a dismissible window. */
  readonly dismiss = output<void>();

  protected readonly shaking = signal(false);

  private readonly window = viewChild.required<ElementRef<HTMLElement>>('window');

  constructor() {
    // Remembered before the window takes focus, so it can be handed back.
    const previous = document.activeElement;

    afterNextRender(() => {
      const window = this.window().nativeElement;
      const target =
        window.querySelector<HTMLElement>('[data-autofocus]') ??
        this.focusables()[0] ??
        window;
      target.focus();
    });

    inject(DestroyRef).onDestroy(() => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.dismissible()) {
        this.dismiss.emit();
      } else {
        this.shake();
      }
      return;
    }

    if (event.key === 'Tab') {
      this.keepFocusInside(event);
    }
  }

  protected onBackdropPress(event: PointerEvent): void {
    event.preventDefault();
    this.shake();
    this.window().nativeElement.focus();
  }

  /** `Tab` past the last focusable goes to the first, and back again. */
  private keepFocusInside(event: KeyboardEvent): void {
    const focusables = this.focusables();
    const first = focusables[0];
    const last = focusables.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const window = this.window().nativeElement;
    if (event.shiftKey && (active === first || active === window)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.window().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.hasAttribute('inert') && element.getAttribute('aria-hidden') !== 'true',
    );
  }

  private shake(): void {
    // Restarted if it is already running, so every press is answered.
    this.shaking.set(false);
    queueMicrotask(() => this.shaking.set(true));
  }
}
