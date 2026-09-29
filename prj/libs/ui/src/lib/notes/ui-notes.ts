import { Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';

/**
 * The bottom panel's Notes tab (PRD 001, §12.2): one plain-text box filling
 * the panel body.
 *
 * Presentational: it shows `text`, reports every edit and the moment the box
 * is left, and the application decides where the text is kept and when it is
 * written. `focusRequest` works like the commit box's `messageFocus` — each
 * new value above zero puts the cursor in the box once it has rendered.
 */
@Component({
  selector: 'ui-notes',
  template: `
    <textarea
      #box
      class="notes-box"
      spellcheck="false"
      [attr.aria-label]="label()"
      [attr.aria-invalid]="error() ? 'true' : null"
      [placeholder]="placeholder()"
      [value]="text()"
      (input)="onInput($event)"
      (blur)="commit.emit()"
    ></textarea>
    @if (error(); as message) {
      <p class="notes-error" role="alert">{{ message }}</p>
    }
  `,
  styleUrl: './ui-notes.scss',
  host: { class: 'ui-notes' },
})
export class UiNotes {
  readonly text = input.required<string>();
  readonly placeholder = input('');
  readonly label = input('Notes');
  /** Why the text could not be kept, shown under the box; `null` when it was. */
  readonly error = input<string | null>(null);
  /** Raise to put the cursor in the box. */
  readonly focusRequest = input(0);

  /** What the box holds, as it is typed. */
  readonly textChange = output<string>();
  /** The box lost focus: a good moment to write what is waiting. */
  readonly commit = output<void>();

  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  private seenFocus = 0;

  constructor() {
    afterRenderEffect(() => {
      const token = this.focusRequest();
      if (token !== this.seenFocus) {
        this.seenFocus = token;
        if (token > 0) {
          this.box().nativeElement.focus();
        }
      }
    });
  }

  protected onInput(event: Event): void {
    this.textChange.emit((event.target as HTMLTextAreaElement).value);
  }
}
