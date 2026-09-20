import { Component, ElementRef, inject, input, output, signal } from '@angular/core';
import type { UiSashResize } from '../models';

/**
 * The 4px drag handle between two workbench areas.
 *
 * Transparent until hovered, focused, dragged or marked `active`, when an
 * `::after` overlay fills it with the accent colour — the same trick the mockup
 * uses, so the handle never shifts the layout. A `::before` pseudo-element
 * widens the hit area to ~8px without touching the visual line.
 *
 * Dragging is reported, never applied: each pointer move emits the pixels
 * travelled along the sash's axis *since the previous event* and the owner of
 * the layout decides what that means. Arrow keys emit a `step()`-sized move
 * followed by an `end`, so a keyboard drag is a sequence of complete gestures.
 *
 * As a focusable `separator` it exposes `aria-valuenow`/`min`/`max` whenever
 * `value()` is given, which is what makes the position audible while it moves.
 */
@Component({
  selector: 'ui-sash',
  template: '',
  styleUrl: './ui-sash.scss',
  host: {
    role: 'separator',
    tabindex: '0',
    '[attr.aria-orientation]': 'orientation()',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'ariaValue()',
    '[attr.aria-valuemin]': 'ariaMin()',
    '[attr.aria-valuemax]': 'ariaMax()',
    '[class.is-horizontal]': 'orientation() === "horizontal"',
    '[class.is-vertical]': 'orientation() === "vertical"',
    '[class.is-active]': 'active()',
    '[class.is-dragging]': 'dragging()',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerUp($event)',
    '(lostpointercapture)': 'onPointerUp($event)',
    '(keydown)': 'onKeyDown($event)',
  },
})
export class UiSash {
  /**
   * `vertical` separates two columns (a vertical line, `col-resize`);
   * `horizontal` separates two rows (a horizontal line, `row-resize`).
   */
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');

  /** Held by the pointer; keeps the accent fill visible. */
  readonly active = input<boolean>(false);

  readonly label = input<string>('Resize');

  /** Current position, in whatever unit the owner reports; `null` hides the value. */
  readonly value = input<number | null>(null);

  readonly min = input<number | null>(null);

  readonly max = input<number | null>(null);

  /** Pixels moved by one arrow key press. */
  readonly step = input<number>(24);

  readonly resize = output<UiSashResize>();

  /** True between `pointerdown` and the matching release. */
  protected readonly dragging = signal(false);

  /** Pointer position along the axis at the previous event of this drag. */
  private last = 0;

  private pointerId: number | null = null;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected ariaValue(): number | null {
    return this.rounded(this.value());
  }

  protected ariaMin(): number | null {
    return this.value() === null ? null : this.rounded(this.min());
  }

  protected ariaMax(): number | null {
    return this.value() === null ? null : this.rounded(this.max());
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.dragging()) {
      return;
    }
    event.preventDefault();
    // Guarded: capture is what keeps moves flowing to this element once the
    // pointer leaves the 8px hit area, but not every test DOM implements it.
    const element = this.host.nativeElement;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
    this.pointerId = event.pointerId;
    this.last = this.axisOf(event);
    this.dragging.set(true);
    this.resize.emit({ delta: 0, phase: 'start' });
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.dragging() || event.pointerId !== this.pointerId) {
      return;
    }
    const position = this.axisOf(event);
    const delta = position - this.last;
    this.last = position;
    this.resize.emit({ delta, phase: 'move' });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.dragging() || event.pointerId !== this.pointerId) {
      return;
    }
    const element = this.host.nativeElement;
    if (typeof element.hasPointerCapture === 'function' && element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    this.pointerId = null;
    this.dragging.set(false);
    this.resize.emit({ delta: 0, phase: 'end' });
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const vertical = this.orientation() === 'vertical';
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    const forward = vertical ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== forward) {
      return;
    }
    event.preventDefault();
    const delta = event.key === back ? -this.step() : this.step();
    this.resize.emit({ delta, phase: 'move' });
    this.resize.emit({ delta: 0, phase: 'end' });
  }

  /** The coordinate the sash moves along: x for a vertical line, y for a horizontal one. */
  private axisOf(event: PointerEvent): number {
    return this.orientation() === 'vertical' ? event.clientX : event.clientY;
  }

  private rounded(value: number | null): number | null {
    return value === null ? null : Math.round(value);
  }
}
