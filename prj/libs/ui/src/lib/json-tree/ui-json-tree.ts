import { Component, computed, effect, inject, input, signal, untracked, viewChild, type ElementRef } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiIcon } from '../icon/ui-icon';
import { visibleRange } from '../virtual/ui-virtual-viewport';
import { UiJsonTreeService } from './ui-json-tree.service';

/** Height of a row, as `--vsc-row-height` has it. */
const ROW_HEIGHT = 22;

let trees = 0;

/**
 * The JSON viewer (PRD 005, §5): a document as a tree of its objects and
 * arrays, coloured as the editor colours JSON — keys, strings, numbers,
 * `true` / `false` / `null` — with how many keys or items each holds.
 *
 * The rows are drawn only near the view, so an array of a hundred thousand
 * opens as quickly as one of ten. The keyboard is the ARIA tree's, on one tab
 * stop (`aria-activedescendant`, as the rows come and go under it): `↑` / `↓`,
 * `Home` / `End`, the page keys, `→` opens or steps in, `←` closes or steps
 * out, `Enter` / `Space` open and close. The header says where the cursor is
 * (`$.items[0].name`) and opens or closes everything. The rows' text can be
 * selected and copied.
 */
@Component({
  selector: 'ui-json-tree',
  imports: [UiIcon, UiIconButton],
  templateUrl: './ui-json-tree.html',
  styleUrl: './ui-json-tree.scss',
  providers: [UiJsonTreeService],
})
export class UiJsonTree {
  /** The parsed document. */
  readonly value = input.required<unknown>();

  /** Accessible name of the tree — in practice the file's path. */
  readonly label = input<string>('JSON');

  protected readonly view = inject(UiJsonTreeService);
  protected readonly rowHeight = ROW_HEIGHT;
  private readonly uid = `ui-json-${++trees}`;

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(0);

  protected readonly window = computed(() => {
    const rows = this.view.rows();
    const range = visibleRange({
      total: rows.length,
      lineHeight: ROW_HEIGHT,
      perLine: 1,
      scrollTop: this.scrollTop(),
      viewportHeight: this.viewportHeight(),
      leading: 0,
    });
    return { start: range.start, rows: rows.slice(range.start, range.end) };
  });

  protected readonly activeId = computed(() => `${this.uid}-${this.view.focusedIndex()}`);

  constructor() {
    effect(() => {
      const value = this.value();
      untracked(() => this.view.setValue(value));
    });

    effect((onCleanup) => {
      const viewport = this.viewportRef().nativeElement;
      const measure = (): void => this.viewportHeight.set(viewport.clientHeight);
      measure();
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(measure);
      observer.observe(viewport);
      onCleanup(() => observer.disconnect());
    });
  }

  protected rowId(index: number): string {
    return `${this.uid}-${index}`;
  }

  protected onScroll(): void {
    this.scrollTop.set(this.viewportRef().nativeElement.scrollTop);
  }

  protected onRowPress(id: string): void {
    this.view.focus(id);
  }

  /** A double click opens or closes a container — but not on its twisty, whose two clicks already did. */
  protected onRowDouble(event: MouseEvent, id: string, size: number): void {
    if (size > 0 && !(event.target instanceof Element && event.target.closest('.twisty'))) {
      this.view.toggle(id);
    }
  }

  protected onTwisty(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.view.focus(id);
    this.view.toggle(id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const page = Math.max(1, Math.floor(this.viewportHeight() / ROW_HEIGHT) - 1);
    switch (event.key) {
      case 'ArrowDown':
        this.view.move(1);
        break;
      case 'ArrowUp':
        this.view.move(-1);
        break;
      case 'PageDown':
        this.view.move(page);
        break;
      case 'PageUp':
        this.view.move(-page);
        break;
      case 'Home':
        this.view.moveTo(0);
        break;
      case 'End':
        this.view.moveTo(-1);
        break;
      case 'ArrowRight':
        this.view.right();
        break;
      case 'ArrowLeft':
        this.view.left();
        break;
      case 'Enter':
      case ' ':
        this.view.toggle(this.view.focusedId());
        break;
      default:
        return;
    }
    event.preventDefault();
    this.reveal();
  }

  /** Scrolls the cursor's row into view — it may not be drawn yet. */
  private reveal(): void {
    const viewport = this.viewportRef().nativeElement;
    const top = this.view.focusedIndex() * ROW_HEIGHT;
    const height = viewport.clientHeight;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (height > 0 && top + ROW_HEIGHT > viewport.scrollTop + height) {
      viewport.scrollTop = top + ROW_HEIGHT - height;
    }
    this.scrollTop.set(viewport.scrollTop);
  }
}
