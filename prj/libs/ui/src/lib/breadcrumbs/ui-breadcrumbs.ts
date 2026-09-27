import { Component, ElementRef, afterRenderEffect, input, output, signal, viewChild } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiBreadcrumb } from '../models';

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

  readonly select = output<string>();

  /** A path typed into the bar and confirmed with `Enter`. */
  readonly submit = output<string>();

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
    this.editing.set(true);
  }

  /** A click on the bar itself — not on a crumb — edits the path, as a file manager's address bar does. */
  protected onBarClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest('.crumb') === null) {
      this.edit();
    }
  }

  protected onFieldKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const value = (event.target as HTMLInputElement).value;
      this.stop();
      this.submit.emit(value);
    } else if (event.key === 'Escape') {
      this.stop();
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
