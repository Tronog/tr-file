import { Component, afterRenderEffect, computed, effect, inject, input, output, signal, untracked, viewChild, type ElementRef } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiSearchField } from '../controls/ui-search-field';
import { matchParts } from '../json-tree/ui-json-tree.service';
import { visibleRange } from '../virtual/ui-virtual-viewport';
import { columnName } from './delimited-text';
import { UiSheetService, type UiCell } from './ui-sheet.service';

/** Height of a row, and of the column header, in CSS pixels. */
const ROW_HEIGHT = 22;

/** Width of the row numbers' column. */
const ROW_HEAD_WIDTH = 48;

/** A column's width is fitted to what its first rows hold, between these. */
const MIN_WIDTH = 56;
const MAX_WIDTH = 320;
const CHAR_WIDTH = 7.2;
const SAMPLE_ROWS = 200;

let sheets = 0;

/**
 * A spreadsheet of a delimited file (PRD 015, §1): its cells under column
 * letters and row numbers, to look through or — `editable` — to edit as
 * Excel does.
 *
 * Only the rows near the view are drawn, so a file of a hundred thousand
 * lines scrolls as one of ten. One tab stop (`role="grid"`, the active cell
 * its `aria-activedescendant`), and Excel's keys on it:
 *
 * - `↑` `↓` `←` `→` move the active cell, `Shift` extends the selection,
 *   `Ctrl` goes to the edge of the data; `Home` / `End` (with `Ctrl`, the
 *   sheet's first and last cells), the page keys, `Ctrl`+`A` all;
 * - a press selects a cell — dragging, or with `Shift`, a range — and a
 *   column letter or a row number selects the column or the row;
 * - `Ctrl`+`C` copies the selection as a spreadsheet does, tab-separated.
 *
 * Editable, also: typing replaces the active cell, `F2` or a double click
 * edits it in place, `Enter` / `Tab` (with `Shift`, back) put the value in
 * and move on, `Escape` drops it; `Delete` empties the selection, `Ctrl`+`V`
 * pastes from the active cell — one value fills the selection —, `Ctrl`+`X`
 * cuts, `Ctrl`+`Z` / `Ctrl`+`Y` undo and redo. Every change reports the
 * cells (`rowsChange`).
 *
 * Search (§2.1): `Ctrl`+`F` opens a find bar over the sheet; every cell
 * holding what is typed (case ignored) is marked, and `Enter` /
 * `Shift`+`Enter` — `F3` / `Shift`+`F3` on the sheet — take the active cell to
 * the next or previous one, row by row, round at either end. `Escape` closes
 * it, the sheet keeping the keyboard on the match.
 *
 * Copy and paste go through the browser's own `copy` / `paste` events, so
 * they need no permission and work in a page that is not a secure context.
 */
@Component({
  selector: 'ui-sheet',
  imports: [UiIconButton, UiSearchField],
  templateUrl: './ui-sheet.html',
  styleUrl: './ui-sheet.scss',
  providers: [UiSheetService],
  host: {
    '(document:copy)': 'onClipboard($event, "copy")',
    '(document:cut)': 'onClipboard($event, "cut")',
    '(document:paste)': 'onClipboard($event, "paste")',
    '(document:pointerup)': 'dragging = false',
  },
})
export class UiSheet {
  /** The cells, row by row. */
  readonly rows = input.required<readonly (readonly string[])[]>();

  readonly editable = input<boolean>(false);

  /** Accessible name of the grid — in practice the file's path. */
  readonly label = input<string>('Sheet');

  /** The cells, after each change. */
  readonly rowsChange = output<readonly (readonly string[])[]>();

  /** Where the selection is, as a spreadsheet's name box says it: `B4`, `B4:C9`. */
  readonly selectionChange = output<string>();

  protected readonly view = inject(UiSheetService);
  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly rowHeadWidth = ROW_HEAD_WIDTH;
  protected readonly columnName = columnName;
  protected readonly parts = matchParts;

  /** The find bar is open; bump `findFocus` to put the keyboard in it. */
  protected readonly finding = signal(false);
  protected readonly findFocus = signal(0);

  /** `3 of 12`, `No results`, or nothing while nothing is looked for. */
  protected readonly findLabel = computed(() => {
    const total = this.view.matches().length;
    if (this.view.query() === '') {
      return '';
    }
    if (total === 0) {
      return 'No results';
    }
    const shown = total >= 10_000 ? '10000+' : String(total);
    const index = this.view.matchIndex();
    return index < 0 ? `${shown} found` : `${index + 1} of ${shown}`;
  });
  private readonly uid = `ui-sheet-${++sheets}`;

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('cellInput');
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(0);
  protected dragging = false;

  protected readonly columns = computed(() => Array.from({ length: this.view.columnCount() }, (_, index) => index));

  /** Each column fitted to its first rows. */
  protected readonly widths = computed(() => {
    const rows = this.view.rows();
    const sample = rows.slice(0, SAMPLE_ROWS);
    return this.columns().map((column) => {
      const longest = sample.reduce((widest, row) => Math.max(widest, (row[column] ?? '').length), 0);
      return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest * CHAR_WIDTH + 16)));
    });
  });

  protected readonly totalWidth = computed(() => this.widths().reduce((sum, width) => sum + width, ROW_HEAD_WIDTH));

  protected readonly window = computed(() => {
    const total = this.view.rowCount();
    const range = visibleRange({
      total,
      lineHeight: ROW_HEIGHT,
      perLine: 1,
      scrollTop: this.scrollTop(),
      viewportHeight: this.viewportHeight(),
      leading: ROW_HEIGHT,
    });
    return {
      above: range.start * ROW_HEIGHT,
      below: (total - range.end) * ROW_HEIGHT,
      rows: Array.from({ length: range.end - range.start }, (_, index) => range.start + index),
    };
  });

  protected readonly activeId = computed(() => this.cellId(this.view.active().row, this.view.active().column));

  /** `B4`, or `B4:C9` for a range. */
  private readonly where = computed(() => {
    const range = this.view.range();
    const first = `${columnName(range.left)}${range.top + 1}`;
    return range.top === range.bottom && range.left === range.right ? first : `${first}:${columnName(range.right)}${range.bottom + 1}`;
  });

  constructor() {
    effect(() => {
      const rows = this.rows();
      untracked(() => this.view.setData(rows));
    });
    effect(() => {
      const editable = this.editable();
      untracked(() => this.view.setEditable(editable));
    });
    effect(() => {
      const where = this.where();
      untracked(() => this.selectionChange.emit(where));
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

    // A cell being edited has the keyboard, its caret after what is in it.
    afterRenderEffect(() => {
      const editing = this.view.editing();
      const field = this.inputRef()?.nativeElement;
      if (editing !== null && field !== undefined && document.activeElement !== field) {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      }
    });
  }

  protected cellId(row: number, column: number): string {
    return `${this.uid}-${row}-${column}`;
  }

  protected onScroll(): void {
    this.scrollTop.set(this.viewportRef().nativeElement.scrollTop);
  }

  /* -- the mouse ----------------------------------------------------------- */

  protected onCellPress(event: PointerEvent, row: number, column: number): void {
    if (event.button !== 0 || this.view.editing()?.row === row && this.view.editing()?.column === column) {
      return;
    }
    this.commitIfEditing();
    this.view.select({ row, column }, event.shiftKey);
    this.dragging = true;
    this.focusGrid();
    event.preventDefault();
  }

  /** Dragging across cells extends the selection to the one under the pointer. */
  protected onCellEnter(event: PointerEvent, row: number, column: number): void {
    if (this.dragging && (event.buttons & 1) === 1 && this.view.editing() === null) {
      this.view.select({ row, column }, true);
    }
  }

  protected onCellDouble(row: number, column: number): void {
    this.view.select({ row, column });
    this.view.beginEdit();
  }

  protected onRowPress(event: PointerEvent, row: number): void {
    this.commitIfEditing();
    const from = event.shiftKey && this.view.selectionKind() === 'rows' ? this.view.active().row : row;
    this.view.selectRows(from, row);
    this.focusGrid();
    event.preventDefault();
  }

  protected onColumnPress(event: PointerEvent, column: number): void {
    this.commitIfEditing();
    const from = event.shiftKey && this.view.selectionKind() === 'columns' ? this.view.active().column : column;
    this.view.selectColumns(from, column);
    this.focusGrid();
    event.preventDefault();
  }

  protected onCornerPress(event: PointerEvent): void {
    this.commitIfEditing();
    this.view.selectAll();
    this.focusGrid();
    event.preventDefault();
  }

  /* -- the keyboard -------------------------------------------------------- */

  protected onKeydown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    // `Alt` chords are the panel's (`Alt`+`↑` up a folder), `Ctrl`+page keys the tab bar's.
    if (event.target !== this.viewportRef().nativeElement || event.altKey || (ctrl && (event.key === 'PageUp' || event.key === 'PageDown'))) {
      return;
    }
    const page = Math.max(1, Math.floor(this.viewportHeight() / ROW_HEIGHT) - 2);
    const editable = this.view.editable();
    const step = (rows: number, columns: number): void =>
      ctrl ? this.view.jump(rows, columns, event.shiftKey) : this.view.moveBy(rows, columns, event.shiftKey);

    switch (event.key) {
      case 'ArrowDown':
        step(1, 0);
        break;
      case 'ArrowUp':
        step(-1, 0);
        break;
      case 'ArrowRight':
        step(0, 1);
        break;
      case 'ArrowLeft':
        step(0, -1);
        break;
      case 'PageDown':
        this.view.moveBy(page, 0, event.shiftKey);
        break;
      case 'PageUp':
        this.view.moveBy(-page, 0, event.shiftKey);
        break;
      case 'Home':
        this.view.select({ row: ctrl ? 0 : this.view.active().row, column: 0 }, event.shiftKey);
        break;
      case 'End':
        this.view.select(
          { row: ctrl ? Math.max(0, this.view.dataRows() - 1) : this.view.active().row, column: Math.max(0, this.view.dataColumns() - 1) },
          event.shiftKey,
        );
        break;
      case 'F3':
        if (!this.findStep(event.shiftKey ? -1 : 1, false)) {
          return;
        }
        break;
      case 'Escape': {
        // The find bar closed; a range back to its active cell; a single cell leaves the key to the panel (it closes the file).
        if (this.finding()) {
          this.closeFind();
          break;
        }
        const range = this.view.range();
        if (range.top === range.bottom && range.left === range.right) {
          return;
        }
        this.view.select(this.view.active());
        break;
      }
      default:
        if (!this.onCommandKey(event, ctrl, editable)) {
          return;
        }
    }
    event.preventDefault();
    event.stopPropagation();
    this.reveal(this.view.selectionKind() === 'cells' && event.shiftKey ? this.cornerCell() : this.view.active());
  }

  /** The keys that are not moves: select all, undo, edit, empty, type. `false` when the key is not the sheet's. */
  private onCommandKey(event: KeyboardEvent, ctrl: boolean, editable: boolean): boolean {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (ctrl && !event.altKey && key === 'a') {
      this.view.selectAll();
      return true;
    }
    if (ctrl && !event.altKey && !event.shiftKey && key === 'f') {
      this.openFind();
      return true;
    }
    if (!editable) {
      return false;
    }
    if (ctrl && !event.altKey && (key === 'z' || key === 'y')) {
      const changed = key === 'y' || event.shiftKey ? this.view.redo() : this.view.undo();
      this.changed(changed);
      return true;
    }
    if (ctrl || event.altKey) {
      return false;
    }
    switch (event.key) {
      case 'Enter':
        this.view.moveBy(event.shiftKey ? -1 : 1, 0);
        return true;
      case 'Tab':
        this.view.moveBy(0, event.shiftKey ? -1 : 1);
        return true;
      case 'F2':
        this.view.beginEdit();
        return true;
      case 'Delete':
      case 'Backspace':
        this.changed(this.view.clear());
        return true;
      default:
        if (event.key.length === 1 && !event.isComposing) {
          this.view.beginEdit(event.key);
          return true;
        }
        return false;
    }
  }

  /** Keys in the cell being edited: `Enter` / `Tab` put the value in and move on; `Escape` drops it. */
  protected onInputKeydown(event: KeyboardEvent): void {
    const editing = this.view.editing();
    if (editing === null || event.isComposing) {
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if ((ctrl && event.key.toLowerCase() === 's') || /^F\d+$/.test(event.key)) {
      // The window's keys — Save, Edit — act on the value typed: it is put in first, and the key goes on.
      this.commit(0, 0);
      return;
    }
    const arrows: Readonly<Record<string, readonly [number, number]>> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    if (event.key === 'Enter' && !ctrl) {
      this.commit(event.shiftKey ? -1 : 1, 0);
    } else if (event.key === 'Tab') {
      this.commit(0, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      this.view.cancelEdit();
      this.focusGrid();
    } else if (editing.replace && !ctrl && !event.shiftKey && arrows[event.key] !== undefined) {
      const [rows, columns] = arrows[event.key] as readonly [number, number];
      this.commit(rows, columns);
    } else {
      // A text field's own key; the panel and the window keep theirs to themselves.
      if (!ctrl && !event.altKey) {
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  protected onInput(event: Event): void {
    this.view.setEditValue((event.target as HTMLInputElement).value);
  }

  /** Leaving the cell — a press elsewhere — keeps what was typed. */
  protected onInputBlur(): void {
    if (this.view.editing() !== null) {
      this.commit(0, 0, false);
    }
  }

  /* -- search (PRD 015, §2.1) --------------------------------------------- */

  /** Opens the find bar — with the active cell's text as the query, the first time — and puts the keyboard in it. */
  protected openFind(): void {
    if (!this.finding() && this.view.query() === '') {
      const active = this.view.active();
      const text = this.view.cell(active.row, active.column);
      if (text !== '' && !text.includes('\n')) {
        this.view.setQuery(text);
      }
    }
    this.finding.set(true);
    this.findFocus.update((token) => token + 1);
  }

  protected closeFind(): void {
    this.finding.set(false);
    this.view.setQuery('');
    this.focusGrid();
  }

  protected onFindQuery(query: string): void {
    this.view.setQuery(query);
  }

  /** In the bar: `Enter` / `Shift`+`Enter` (and `F3`) to the next or previous match, `Escape` back to the sheet. */
  protected onFindKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'F3') {
      this.findStep(event.shiftKey ? -1 : 1, false);
    } else if (event.key === 'Escape') {
      this.closeFind();
    } else {
      // The box's own keys: the sheet and the window keep theirs to themselves.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** The active cell to the next or previous match, scrolled into view. `false` when nothing matches. */
  protected findStep(direction: 1 | -1, refocus = true): boolean {
    this.commitIfEditing();
    if (!this.view.step(direction)) {
      return false;
    }
    this.reveal(this.view.active());
    if (refocus) {
      this.focusGrid();
    }
    return true;
  }

  /* -- the clipboard ------------------------------------------------------- */

  /** `Ctrl`+`C` / `X` / `V` while the sheet has the keyboard — not a cell being edited, whose text is its own. */
  protected onClipboard(event: ClipboardEvent, kind: 'copy' | 'cut' | 'paste'): void {
    if (document.activeElement !== this.viewportRef().nativeElement || event.clipboardData === null) {
      return;
    }
    if (kind === 'paste') {
      if (this.view.editable()) {
        this.changed(this.view.paste(event.clipboardData.getData('text/plain')));
        event.preventDefault();
      }
      return;
    }
    event.clipboardData.setData('text/plain', this.view.copyText());
    event.preventDefault();
    if (kind === 'cut' && this.view.editable()) {
      this.changed(this.view.clear());
    }
  }

  /* -- internals ----------------------------------------------------------- */

  private commit(rows: number, columns: number, refocus = true): void {
    this.changed(this.view.commitEdit(rows, columns));
    if (refocus) {
      this.focusGrid();
      this.reveal(this.view.active());
    }
  }

  private commitIfEditing(): void {
    if (this.view.editing() !== null) {
      this.changed(this.view.commitEdit());
    }
  }

  private changed(changed: boolean): void {
    if (changed) {
      this.rowsChange.emit(this.view.rows());
    }
  }

  private focusGrid(): void {
    this.viewportRef().nativeElement.focus({ preventScroll: true });
  }

  private cornerCell(): UiCell {
    const range = this.view.range();
    const active = this.view.active();
    return { row: active.row === range.top ? range.bottom : range.top, column: active.column === range.left ? range.right : range.left };
  }

  /** Scrolls `cell` into view, clear of the sticky headers — it may not be drawn yet. */
  private reveal(cell: UiCell): void {
    const viewport = this.viewportRef().nativeElement;
    const top = (cell.row + 1) * ROW_HEIGHT;
    const height = viewport.clientHeight;
    if (top - ROW_HEIGHT < viewport.scrollTop) {
      viewport.scrollTop = top - ROW_HEIGHT;
    } else if (height > 0 && top + ROW_HEIGHT > viewport.scrollTop + height) {
      viewport.scrollTop = top + ROW_HEIGHT - height;
    }
    const widths = this.widths();
    const left = widths.slice(0, cell.column).reduce((sum, width) => sum + width, ROW_HEAD_WIDTH);
    const right = left + (widths[cell.column] ?? 0);
    const width = viewport.clientWidth;
    if (left - ROW_HEAD_WIDTH < viewport.scrollLeft) {
      viewport.scrollLeft = left - ROW_HEAD_WIDTH;
    } else if (width > 0 && right > viewport.scrollLeft + width) {
      viewport.scrollLeft = right - width;
    }
    this.scrollTop.set(viewport.scrollTop);
  }
}
