import { Component, ElementRef, afterRenderEffect, computed, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiBreadcrumb, UiPathSuggestion } from '../models';

/** Instance counter, for the suggestion list's ids. */
let nextBar = 0;

/**
 * The path bar above a panel body.
 *
 * Renders an ordered list of crumbs, each a button that emits its id; the
 * chevron between two crumbs is decorative and hidden from assistive tech, so
 * the path reads as a plain sequence of links.
 *
 * Given a `location`, the bar is also an address bar (PRD 003, §5): a click
 * on its blank space, its edit button, or `edit()` — `UiFileBrowser` calls it
 * for `Ctrl`+`L` — turns it into a text field holding that path. `Enter`
 * reports what was typed as `submit`; `Escape`, or leaving the field, puts
 * the crumbs back. Either way focus goes back to where it was, and where the
 * path leads is the application's business.
 *
 * While it is typed in, the field suggests places below it (PRD 004, §4.2):
 * each change is reported as `pathInput` — and so is the path as the edit
 * begins — and the application answers with `suggestions`, the first chosen
 * already. `↓`/`↑` choose another, `Enter` goes to the one chosen (or, the
 * list closed or empty, to what is typed), `Tab` completes the text to
 * it — a folder with a `/` after it, to go on inside — `Escape` closes the
 * list, and again, the edit. A pointer goes to one by pressing it.
 */
@Component({
  selector: 'ui-breadcrumbs',
  imports: [UiIcon],
  templateUrl: './ui-breadcrumbs.html',
  styleUrl: './ui-breadcrumbs.scss',
})
export class UiBreadcrumbs {
  readonly items = input.required<readonly UiBreadcrumb[]>();

  /** Accessible name of the navigation landmark. */
  readonly label = input<string>('Path');

  /** The path as it is typed, e.g. `/docs/prd`; `undefined` keeps the bar read-only. */
  readonly location = input<string | undefined>(undefined);

  /**
   * A crumb was chosen. Not `select`: an output named after a DOM event also
   * hears that event, and the path field's own `select` — fired whenever its
   * text is selected, as editing the path does at once — bubbles to this
   * host, where it would arrive as a crumb that is an `Event`.
   */
  readonly crumbSelect = output<string>();

  /** A path typed into the bar and confirmed with `Enter` — not `submit`, for the same reason. */
  readonly pathSubmit = output<string>();

  /** Places that fit what is typed, best first; see `pathInput`. */
  readonly suggestions = input<readonly UiPathSuggestion[]>([]);

  /** What the field holds now — as the edit begins, and at each change. */
  readonly pathInput = output<string>();

  /**
   * The suggestion `↓`/`↑` stand on — the first, whenever they change and
   * there are any (PRD 004, §4.2), so `Enter` goes to the best fit at once.
   */
  protected readonly active = linkedSignal<readonly UiPathSuggestion[], number>({
    source: () => this.suggestions(),
    computation: (suggestions) => (suggestions.length > 0 ? 0 : -1),
  });

  /** Closed by `Escape`, open again with the next change. */
  protected readonly listOpen = signal(true);

  protected readonly shown = computed(() => (this.editing() && this.listOpen() ? this.suggestions() : []));

  protected readonly listId = `ui-path-suggestions-${nextBar++}`;

  /** Whether the bar is a text field right now. */
  protected readonly editing = signal(false);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** Focus from before the field took it, handed back when it goes. */
  private previous: Element | null = null;

  constructor() {
    // Once the field exists: focus it, everything selected, so typing replaces the path.
    afterRenderEffect(() => {
      const field = this.field()?.nativeElement;
      if (this.editing() && field !== undefined && document.activeElement !== field) {
        field.focus();
        field.select();
      }
    });
  }

  /** Turns the bar into a text field; does nothing while it cannot be edited. */
  edit(): void {
    if (this.location() === undefined || this.editing()) {
      return;
    }
    this.previous = document.activeElement;
    this.listOpen.set(true);
    this.editing.set(true);
    this.pathInput.emit(this.location() ?? '');
  }

  protected onFieldInput(event: Event): void {
    this.listOpen.set(true);
    this.pathInput.emit((event.target as HTMLInputElement).value);
  }

  /** A suggestion pressed: gone to. `mousedown`, so the field is not left — and the edit given up — first. */
  protected onSuggestionPress(event: MouseEvent, suggestion: UiPathSuggestion): void {
    event.preventDefault();
    this.stop();
    this.pathSubmit.emit(suggestion.value);
  }

  /** A click on the bar itself — not on a crumb — edits the path, as a file manager's address bar does. */
  protected onBarClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest('.crumb') === null) {
      this.edit();
    }
  }

  protected onFieldKeydown(event: KeyboardEvent): void {
    const field = event.target as HTMLInputElement;
    const shown = this.shown();
    if (event.key === 'Enter') {
      const chosen = shown[this.active()];
      this.stop();
      this.pathSubmit.emit(chosen?.value ?? field.value);
    } else if (event.key === 'Escape') {
      // The list first, then the edit.
      if (shown.length > 0) {
        this.listOpen.set(false);
      } else {
        this.stop();
      }
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && shown.length > 0) {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const at = this.active();
      this.active.set(at === -1 ? (step === 1 ? 0 : shown.length - 1) : (at + step + shown.length) % shown.length);
    } else if (event.key === 'Tab' && !event.shiftKey && shown.length > 0) {
      const chosen = shown[Math.max(this.active(), 0)] as UiPathSuggestion;
      field.value = chosen.folder ? `${chosen.value}/` : chosen.value;
      this.pathInput.emit(field.value);
    } else {
      return;
    }
    event.preventDefault();
    // Nothing around the bar should take these keys as its own.
    event.stopPropagation();
  }

  /** Leaving the field gives up the edit; the crumbs come back. */
  protected onFieldBlur(): void {
    if (this.editing()) {
      this.editing.set(false);
      this.previous = null;
    }
  }

  private stop(): void {
    const previous = this.previous;
    this.previous = null;
    this.editing.set(false);
    if (previous instanceof HTMLElement && previous.isConnected) {
      previous.focus();
    }
  }
}
