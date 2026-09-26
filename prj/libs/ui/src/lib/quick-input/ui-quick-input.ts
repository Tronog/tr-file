import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { UiProgress } from '../progress/ui-progress';
import type { UiQuickInputMessage, UiQuickPickItem } from '../models';

let nextId = 0;

/** A piece of a label, highlighted or not. */
interface LabelPart {
  readonly text: string;
  readonly match: boolean;
}

/**
 * VS Code's quick input (PRD 009, §1) — the box the command palette opens in,
 * at the top of the window.
 *
 * One field and, under it, either a list to pick from or a line of text to
 * explain what to type. Keyboard focus never leaves the field: `↑`/`↓` move
 * the active row (wrapping), `Enter` accepts — the active row, or the value —
 * and `Escape` closes; the list is the field's popup, announced through
 * `aria-activedescendant`. The mouse picks a row with a click. Leaving it — a
 * click elsewhere, focus moving away — closes it too, as VS Code's does.
 *
 * Render-only: the application filters the list, tracks the active row,
 * validates the value and decides what accepting means. `busy` draws the thin
 * progress bar along its top while an answer is being worked out.
 */
@Component({
  selector: 'ui-quick-input',
  imports: [UiProgress],
  templateUrl: './ui-quick-input.html',
  styleUrl: './ui-quick-input.scss',
  host: {
    class: 'ui-quick-input',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class UiQuickInput {
  readonly value = input<string>('');
  readonly placeholder = input<string>('');
  /** Accessible name of the field. */
  readonly label = input<string>('Quick input');
  readonly password = input<boolean>(false);
  /** The rows to pick from; empty in a plain input step. */
  readonly items = input<readonly UiQuickPickItem[]>([]);
  readonly activeId = input<string | null>(null);
  /** Shown under the field — a hint, a validation message. */
  readonly message = input<UiQuickInputMessage | null>(null);
  /** Shown in place of the list when `showList` and there is nothing in it. */
  readonly emptyText = input<string>('No matching results');
  /** Whether this step picks from a list at all. */
  readonly showList = input<boolean>(true);
  readonly busy = input<boolean>(false);

  readonly valueChange = output<string>();
  readonly activeChange = output<string>();
  /** `Enter`, or a click on a row (which is made active first). */
  readonly accept = output<void>();
  readonly dismiss = output<void>();

  protected readonly listId = `ui-quick-input-list-${(nextId += 1)}`;

  protected readonly optionId = (id: string): string => `${this.listId}-${id}`;

  protected readonly activeOption = computed(() => {
    const id = this.activeId();
    return id !== null && this.items().some((item) => item.id === id) ? this.optionId(id) : null;
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  /** Focus from before it opened, handed back when it closes by keyboard. */
  private readonly previous: Element | null = document.activeElement;

  constructor() {
    afterNextRender(() => {
      const field = this.field().nativeElement;
      field.focus();
      field.select();
    });
  }

  /** A label split into highlighted and plain parts. */
  protected parts(item: UiQuickPickItem): readonly LabelPart[] {
    const ranges = [...(item.highlights ?? [])].sort((a, b) => a[0] - b[0]);
    const parts: LabelPart[] = [];
    let at = 0;
    for (const [start, end] of ranges) {
      if (start > at) {
        parts.push({ text: item.label.slice(at, start), match: false });
      }
      parts.push({ text: item.label.slice(Math.max(start, at), end), match: true });
      at = Math.max(at, end);
    }
    if (at < item.label.length) {
      parts.push({ text: item.label.slice(at), match: false });
    }
    return parts;
  }

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        this.step(event.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Enter':
        this.accept.emit();
        break;
      case 'Escape':
        this.restoreFocus();
        this.dismiss.emit();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  protected onPick(item: UiQuickPickItem): void {
    this.activeChange.emit(item.id);
    this.accept.emit();
  }

  /** Keeps the press on a row from taking focus off the field first. */
  protected onRowPointerDown(event: PointerEvent): void {
    event.preventDefault();
  }

  /** Focus moving out of the box closes it — a click elsewhere, `Tab`, another window. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !this.host.contains(next)) {
      this.dismiss.emit();
    }
  }

  private step(delta: 1 | -1): void {
    const items = this.items();
    if (items.length === 0) {
      return;
    }
    const current = items.findIndex((item) => item.id === this.activeId());
    const next = current === -1 ? (delta === 1 ? 0 : items.length - 1) : (current + delta + items.length) % items.length;
    const item = items[next];
    if (item) {
      this.activeChange.emit(item.id);
      // Row ids are unique on the page, so the document can find it without escaping.
      document.getElementById(this.optionId(item.id))?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private restoreFocus(): void {
    if (this.previous instanceof HTMLElement && this.previous.isConnected) {
      this.previous.focus();
    }
  }
}
