import { Component, ElementRef, afterNextRender, computed, inject, input, linkedSignal, output, viewChild } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiZoomRequest } from '../models/chrome.model';

/** How far one notch of the slider moves, in percent. */
const SLIDER_STEP = 5;

/**
 * The zoom control's dropdown (PRD 001, §8.2.3): zoom out, the level, zoom in,
 * back to 100 %, and a slider — VS Code's and a browser's zoom in one place.
 *
 * The slider applies its level when it is let go of (`change`), not while it
 * is dragged: zooming rescales the page, the slider with it, so following the
 * pointer would have the thumb run away from under it. The level shown follows
 * the thumb meanwhile. Arrow keys on it apply each notch, as `change` fires.
 *
 * It takes the keyboard when it opens (the slider) and gives it back to the
 * button it hangs from on `Escape`; a press outside closes it.
 */
@Component({
  selector: 'ui-zoom-menu',
  imports: [UiIcon],
  template: `
    <div class="zoom-row">
      <button type="button" class="zoom-step" title="Zoom Out" aria-label="Zoom Out" [disabled]="percent() <= min()" (click)="request.emit({ kind: 'out' })">
        <ui-icon name="minus" />
      </button>
      <span class="zoom-value" aria-live="polite">{{ shown() }}%</span>
      <button type="button" class="zoom-step" title="Zoom In" aria-label="Zoom In" [disabled]="percent() >= max()" (click)="request.emit({ kind: 'in' })">
        <ui-icon name="plus" />
      </button>
      <button type="button" class="zoom-reset" title="Reset Zoom" [disabled]="percent() === 100" (click)="request.emit({ kind: 'reset' })">100%</button>
    </div>
    <input
      #slider
      type="range"
      class="zoom-slider"
      aria-label="Zoom level"
      [min]="min()"
      [max]="max()"
      [step]="step"
      [value]="percent()"
      [attr.aria-valuetext]="shown() + '%'"
      (input)="onInput($event)"
      (change)="onChange($event)"
    />
  `,
  styleUrl: './ui-zoom-menu.scss',
  host: {
    role: 'dialog',
    'aria-label': 'Zoom',
    '(keydown.escape)': 'onEscape($event)',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
})
export class UiZoomMenu {
  readonly percent = input.required<number>();
  readonly min = input(50);
  readonly max = input(300);

  readonly request = output<UiZoomRequest>();

  /** Closed: `true` when the keyboard should go back to the button (`Escape`). */
  readonly dismiss = output<boolean>();

  protected readonly step = SLIDER_STEP;

  /** The level under the slider's thumb, until it is let go of and the window says what it is. */
  private readonly dragged = linkedSignal<number, number | null>({ source: this.percent, computation: () => null });

  protected readonly shown = computed(() => Math.round(this.dragged() ?? this.percent()));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly slider = viewChild.required<ElementRef<HTMLInputElement>>('slider');

  constructor() {
    afterNextRender(() => this.slider().nativeElement.focus());
  }

  protected onInput(event: Event): void {
    this.dragged.set(Number((event.target as HTMLInputElement).value));
  }

  protected onChange(event: Event): void {
    const percent = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(percent)) {
      this.request.emit({ kind: 'set', percent });
    }
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.dismiss.emit(true);
  }

  /** A press anywhere but here, or the button it hangs from (which toggles it itself). */
  protected onDocumentPointerDown(event: Event): void {
    const target = event.target;
    if (!(target instanceof Node) || this.host.nativeElement.contains(target)) {
      return;
    }
    if (target instanceof Element && target.closest('[data-zoom-toggle]')) {
      return;
    }
    this.dismiss.emit(false);
  }
}
