import { Component, afterRenderEffect, computed, effect, inject, input, output, signal, untracked, viewChild, type ElementRef } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiSearchField } from '../controls/ui-search-field';
import { UiIcon } from '../icon/ui-icon';
import { visibleRange } from '../virtual/ui-virtual-viewport';
import { UiJsonTreeService, matchParts, type UiJsonEdit } from './ui-json-tree.service';

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
 * out, `Space` opens and closes. The header says where the cursor is
 * (`$.items[0].name`) and opens or closes everything. The rows' text can be
 * selected and copied.
 *
 * Search (§5.1): `Ctrl`+`F` — or the header's box — looks through every key
 * and value, open or not; `Enter` / `Shift`+`Enter` (or `F3`) step through
 * the matches, opening what each is in, and the matching text is marked.
 *
 * Editing (§5.2), while `editable`: a double click on a key or a value, `F2`
 * on a row (its value, or the key of an object or array), `Enter` on a value,
 * types into it in place; `Enter` puts it in, `Escape` drops it. A string stays a
 * string; another value is read as JSON. Each edit is reported (`edit`) for
 * the application to write into the file.
 */
@Component({
  selector: 'ui-json-tree',
  imports: [UiIcon, UiIconButton, UiSearchField],
  templateUrl: './ui-json-tree.html',
  styleUrl: './ui-json-tree.scss',
  providers: [UiJsonTreeService],
})
export class UiJsonTree {
  /** The parsed document. */
  readonly value = input.required<unknown>();

  /** Accessible name of the tree — in practice the file's path. */
  readonly label = input<string>('JSON');

  /** Keys and values may be edited in place (§5.2). */
  readonly editable = input<boolean>(false);

  /** A key renamed or a value changed in the tree. */
  readonly edit = output<UiJsonEdit>();

  protected readonly view = inject(UiJsonTreeService);
  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly parts = matchParts;
  private readonly uid = `ui-json-${++trees}`;

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly searchRef = viewChild.required(UiSearchField);
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('editInput');
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

  /** `3 of 12`, `No results`, or nothing while there is nothing to look for. */
  protected readonly matchLabel = computed(() => {
    const total = this.view.matches().length;
    if (this.view.query().trim() === '') {
      return '';
    }
    if (total === 0) {
      return 'No results';
    }
    const current = this.view.current();
    return current < 0 ? `${total} found` : `${current + 1} of ${total}`;
  });

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

    // The key or value being edited has the keyboard, its text selected.
    afterRenderEffect(() => {
      const editing = this.view.editing();
      const field = this.inputRef()?.nativeElement;
      if (editing !== null && field !== undefined && document.activeElement !== field) {
        field.focus();
        field.select();
      }
    });
  }

  protected rowId(index: number): string {
    return `${this.uid}-${index}`;
  }

  protected isEditing(id: string, part: 'key' | 'value'): boolean {
    const editing = this.view.editing();
    return editing !== null && editing.id === id && editing.part === part;
  }

  protected onScroll(): void {
    this.scrollTop.set(this.viewportRef().nativeElement.scrollTop);
  }

  protected onRowPress(id: string): void {
    this.view.focus(id);
  }

  /** A double click: on a key or a value, editing it (§5.2); elsewhere, opening or closing the row. */
  protected onRowDouble(event: MouseEvent, id: string, size: number): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.twisty')) {
      return;
    }
    const part = target?.closest('.key') ? 'key' : target?.closest('.value') ? 'value' : null;
    if (this.editable() && part !== null && this.view.beginEdit(id, part)) {
      return;
    }
    if (size > 0) {
      this.view.toggle(id);
    }
  }

  protected onTwisty(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.view.focus(id);
    this.view.toggle(id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.target !== this.viewportRef().nativeElement || event.altKey) {
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl) {
      if (event.key.toLowerCase() === 'f') {
        this.searchRef().focus();
        this.claim(event);
      }
      return;
    }
    const page = Math.max(1, Math.floor(this.viewportHeight() / ROW_HEIGHT) - 1);
    const row = this.view.rows()[this.view.focusedIndex()];
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
      case ' ':
        this.view.toggle(this.view.focusedId());
        break;
      case 'F3':
        this.view.step(event.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        // A value is edited; an object or array — or anything, read-only — opens and closes.
        if (row === undefined || !this.editable() || row.size > 0 || !this.view.beginEdit(row.id, 'value')) {
          this.view.toggle(this.view.focusedId());
        }
        break;
      case 'F2':
        // A value is edited, an object's or array's key renamed.
        if (row === undefined || !this.editable() || !this.view.beginEdit(row.id, row.size > 0 || !('scalar' in row) ? 'key' : 'value')) {
          return;
        }
        break;
      default:
        return;
    }
    this.claim(event);
    this.reveal();
  }

  /* -- search (§5.1) ------------------------------------------------------- */

  protected onQuery(query: string): void {
    this.view.setQuery(query);
  }

  /** In the search box: `Enter` / `Shift`+`Enter` step through the matches, `Escape` clears it and goes back to the tree. */
  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'F3') {
      this.find(event.shiftKey ? -1 : 1, false);
    } else if (event.key === 'Escape') {
      if (this.view.query() !== '') {
        this.view.setQuery('');
      } else {
        this.focusTree();
      }
    } else if (event.key === 'ArrowDown') {
      this.focusTree();
    } else {
      return;
    }
    this.claim(event);
  }

  protected find(direction: 1 | -1, focusTree = true): void {
    if (this.view.step(direction)) {
      this.reveal();
    }
    if (focusTree) {
      this.focusTree();
    }
  }

  /* -- editing (§5.2) ------------------------------------------------------ */

  protected onEditInput(event: Event): void {
    this.view.setDraft((event.target as HTMLInputElement).value);
  }

  protected onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.commit();
    } else if (event.key === 'Escape') {
      this.view.cancelEdit();
      this.focusTree();
    } else {
      // A text field's own key — but the window's chords (`Ctrl`+`S`) go on, with what was typed put in first.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        this.commit();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
      }
      return;
    }
    this.claim(event);
  }

  /** Leaving the field keeps what was typed — when it can be kept. */
  protected onEditBlur(): void {
    if (this.view.editing() !== null) {
      const edit = this.view.commitEdit();
      if (edit !== null) {
        this.edit.emit(edit);
      }
      this.view.cancelEdit();
    }
  }

  private commit(): void {
    const edit = this.view.commitEdit();
    if (this.view.editing() !== null) {
      return; // Refused, and says why: the field keeps the keyboard.
    }
    if (edit !== null) {
      this.edit.emit(edit);
    }
    this.focusTree();
  }

  /* -- internals ----------------------------------------------------------- */

  private claim(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private focusTree(): void {
    this.viewportRef().nativeElement.focus({ preventScroll: true });
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
