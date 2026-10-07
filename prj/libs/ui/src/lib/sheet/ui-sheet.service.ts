import { Service, computed, signal } from '@angular/core';
import { parseDelimited, serializeDelimited } from './delimited-text';

/** A cell, by its 0-based row and column. */
export interface UiCell {
  readonly row: number;
  readonly column: number;
}

/** The selected rectangle, corners included. */
export interface UiCellRange {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** What was chosen to make the selection — whole rows and columns light their headers. */
export type UiSheetSelectionKind = 'cells' | 'rows' | 'columns' | 'all';

/** A cell being typed into: `replace` when typing began it (arrows then move on), else the caret moves in it. */
export interface UiSheetEdit extends UiCell {
  readonly value: string;
  readonly replace: boolean;
}

/** One change to the cells, for undo and redo. */
interface UiSheetPatch {
  readonly cells: readonly (UiCell & { readonly before: string; readonly after: string })[];
}

/** How many changes undo goes back. */
const UNDO_DEPTH = 100;

/** Search stops counting here. */
const MAX_MATCHES = 10_000;

/**
 * The spreadsheet's model (PRD 015, §1): the cells, the selection, the cell
 * being edited and what undo takes back.
 *
 * Provided by `UiSheet`, one per sheet, like the image viewer's and the
 * editor's. The selection is Excel's: an *active* cell — where typing goes —
 * and the corner the range was extended to; `↑` `↓` `←` `→` move the active
 * cell, with `Shift` the corner, with `Ctrl` to the edge of the data. While
 * editable, one empty row and column more than the data are shown, so the
 * table can grow by typing past its end.
 */
@Service()
export class UiSheetService {
  private readonly data = signal<readonly (readonly string[])[]>([]);
  readonly editable = signal(false);

  readonly active = signal<UiCell>({ row: 0, column: 0 });
  private readonly corner = signal<UiCell>({ row: 0, column: 0 });
  readonly selectionKind = signal<UiSheetSelectionKind>('cells');
  readonly editing = signal<UiSheetEdit | null>(null);

  /** What the find bar looks for (PRD 015, §2.1); `''` while it is closed. */
  readonly query = signal('');
  /** Which match the active cell was taken to; `-1` before any. */
  readonly matchIndex = signal(-1);

  /** Every cell holding the query, case ignored, row by row. */
  readonly matches = computed<readonly UiCell[]>(() => {
    const query = this.query().toLowerCase();
    if (query === '') {
      return [];
    }
    const found: UiCell[] = [];
    const rows = this.data();
    for (let row = 0; row < rows.length && found.length < MAX_MATCHES; row++) {
      const cells = rows[row] as readonly string[];
      for (let column = 0; column < cells.length && found.length < MAX_MATCHES; column++) {
        if ((cells[column] as string).toLowerCase().includes(query)) {
          found.push({ row, column });
        }
      }
    }
    return found;
  });

  /** The matches, by `row:column`, for the cells on screen to ask. */
  readonly matchSet = computed(() => new Set(this.matches().map((cell) => `${cell.row}:${cell.column}`)));

  private readonly undoStack: UiSheetPatch[] = [];
  private readonly redoStack: UiSheetPatch[] = [];

  /** The cells, as the sheet reports them after a change. */
  readonly rows = this.data.asReadonly();

  readonly dataRows = computed(() => this.data().length);
  readonly dataColumns = computed(() => this.data().reduce((widest, row) => Math.max(widest, row.length), 0));

  /** What is drawn: the data, at least one cell, and room to grow while editable. */
  readonly rowCount = computed(() => Math.max(1, this.dataRows() + (this.editable() ? 1 : 0)));
  readonly columnCount = computed(() => Math.max(1, this.dataColumns() + (this.editable() ? 1 : 0)));

  readonly range = computed<UiCellRange>(() => {
    const active = this.active();
    const corner = this.corner();
    return {
      top: Math.min(active.row, corner.row),
      bottom: Math.max(active.row, corner.row),
      left: Math.min(active.column, corner.column),
      right: Math.max(active.column, corner.column),
    };
  });

  setData(rows: readonly (readonly string[])[]): void {
    this.data.set(rows);
    this.clamp();
  }

  setEditable(editable: boolean): void {
    if (editable !== this.editable()) {
      this.editable.set(editable);
      this.editing.set(null);
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.clamp();
    }
  }

  cell(row: number, column: number): string {
    return this.data()[row]?.[column] ?? '';
  }

  /* -- selection ----------------------------------------------------------- */

  /** The active cell to `cell`; with `extend`, only the range's far corner. */
  select(cell: UiCell, extend = false): void {
    const target = this.within(cell);
    if (extend) {
      this.corner.set(target);
      return;
    }
    this.active.set(target);
    this.corner.set(target);
    this.selectionKind.set('cells');
  }

  /** `↑` `↓` `←` `→`, the page keys: a step from the active cell — or, extending, from the corner. */
  moveBy(rows: number, columns: number, extend = false): void {
    const from = extend ? this.corner() : this.active();
    this.select({ row: from.row + rows, column: from.column + columns }, extend);
  }

  /**
   * `Ctrl` with an arrow: to the edge of the data, as a spreadsheet goes — to
   * the last filled cell of a run, or the next filled one past a gap, or the
   * end of the sheet.
   */
  jump(rows: number, columns: number, extend = false): void {
    const from = extend ? this.corner() : this.active();
    const filled = (row: number, column: number): boolean => this.cell(row, column) !== '';
    const inside = (row: number, column: number): boolean => row >= 0 && column >= 0 && row < this.rowCount() && column < this.columnCount();
    let row = from.row;
    let column = from.column;
    const nextFilled = inside(row + rows, column + columns) && filled(row + rows, column + columns);
    if (filled(row, column) && nextFilled) {
      while (inside(row + rows, column + columns) && filled(row + rows, column + columns)) {
        row += rows;
        column += columns;
      }
    } else {
      row += rows;
      column += columns;
      while (inside(row, column) && !filled(row, column) && inside(row + rows, column + columns)) {
        row += rows;
        column += columns;
      }
    }
    this.select({ row, column }, extend);
  }

  /** Rows `from` … `to` whole — a row header pressed, `Shift` extending. */
  selectRows(from: number, to: number): void {
    this.active.set(this.within({ row: from, column: 0 }));
    this.corner.set(this.within({ row: to, column: this.columnCount() - 1 }));
    this.selectionKind.set('rows');
  }

  selectColumns(from: number, to: number): void {
    this.active.set(this.within({ row: 0, column: from }));
    this.corner.set(this.within({ row: this.rowCount() - 1, column: to }));
    this.selectionKind.set('columns');
  }

  selectAll(): void {
    this.active.set({ row: 0, column: 0 });
    this.corner.set({ row: this.rowCount() - 1, column: this.columnCount() - 1 });
    this.selectionKind.set('all');
  }

  inRange(row: number, column: number): boolean {
    const range = this.range();
    return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
  }

  /** The selected cells as a spreadsheet copies them: tab-separated, a line per row. */
  copyText(): string {
    const range = this.clippedRange();
    const rows: string[][] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      const cells: string[] = [];
      for (let column = range.left; column <= range.right; column++) {
        cells.push(this.cell(row, column));
      }
      rows.push(cells);
    }
    return serializeDelimited({ rows, delimiter: '\t', trailingNewline: false });
  }

  /* -- search (PRD 015, §2.1) --------------------------------------------- */

  setQuery(query: string): void {
    this.query.set(query);
    this.matchIndex.set(-1);
  }

  isMatch(row: number, column: number): boolean {
    return this.matchSet().has(`${row}:${column}`);
  }

  /**
   * The active cell to the next match — the first after it, the first time —
   * or the one before, round at either end. `false` when nothing matches.
   */
  step(direction: 1 | -1): boolean {
    const matches = this.matches();
    if (matches.length === 0) {
      return false;
    }
    let index = this.matchIndex();
    const at = matches[index];
    const active = this.active();
    if (at === undefined || at.row !== active.row || at.column !== active.column) {
      // From the active cell: the first match past it in reading order — or before it, going back.
      const order = (cell: UiCell): number => cell.row * 1_000_000 + cell.column;
      const here = order(active);
      const after = matches.findIndex((cell) => (direction === 1 ? order(cell) > here : order(cell) >= here));
      index = direction === 1 ? (after === -1 ? 0 : after) : (after === -1 ? matches.length : after) - 1;
    } else {
      index += direction;
    }
    index = (index + matches.length) % matches.length;
    this.matchIndex.set(index);
    this.select(matches[index] as UiCell);
    return true;
  }

  /* -- editing ------------------------------------------------------------- */

  /** `F2`, a double click — the caret in the cell's text — or a key typed, which replaces it. */
  beginEdit(typed?: string): void {
    if (!this.editable()) {
      return;
    }
    const active = this.active();
    this.corner.set(active);
    this.selectionKind.set('cells');
    this.editing.set({ ...active, value: typed ?? this.cell(active.row, active.column), replace: typed !== undefined });
  }

  setEditValue(value: string): void {
    const editing = this.editing();
    if (editing !== null) {
      this.editing.set({ ...editing, value });
    }
  }

  /** The edit into the cell; then the active cell moves on, as `Enter` / `Tab` say. Whether anything changed. */
  commitEdit(rows = 0, columns = 0): boolean {
    const editing = this.editing();
    if (editing === null) {
      return false;
    }
    this.editing.set(null);
    const changed = this.write([{ row: editing.row, column: editing.column, value: editing.value }]);
    this.moveBy(rows, columns);
    return changed;
  }

  cancelEdit(): void {
    this.editing.set(null);
  }

  /** `Delete`: the selected cells emptied. */
  clear(): boolean {
    const range = this.clippedRange();
    const cells: { row: number; column: number; value: string }[] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      for (let column = range.left; column <= range.right; column++) {
        cells.push({ row, column, value: '' });
      }
    }
    return this.write(cells);
  }

  /**
   * A paste: tab-separated text — what a spreadsheet copies — written from
   * the active cell, the selection then covering it. One value pasted on a
   * selection of several fills them all, as a spreadsheet does.
   */
  paste(text: string): boolean {
    const clean = text.replace(/\r?\n$/, '');
    const block = parseDelimited(clean, '\t').rows;
    if (block.length === 0) {
      return false;
    }
    const range = this.range();
    const cells: { row: number; column: number; value: string }[] = [];
    if (block.length === 1 && block[0]?.length === 1) {
      for (let row = range.top; row <= range.bottom; row++) {
        for (let column = range.left; column <= range.right; column++) {
          cells.push({ row, column, value: block[0][0] as string });
        }
      }
    } else {
      block.forEach((values, rowOffset) =>
        values.forEach((value, columnOffset) => cells.push({ row: range.top + rowOffset, column: range.left + columnOffset, value })),
      );
      const width = Math.max(...block.map((values) => values.length));
      this.active.set({ row: range.top, column: range.left });
      this.corner.set({ row: range.top + block.length - 1, column: range.left + width - 1 });
      this.selectionKind.set('cells');
    }
    return this.write(cells);
  }

  undo(): boolean {
    return this.replay(this.undoStack, this.redoStack, 'before');
  }

  redo(): boolean {
    return this.replay(this.redoStack, this.undoStack, 'after');
  }

  /* -- internals ----------------------------------------------------------- */

  /** Writes cells — growing the table where they are past its end — and keeps the change for undo. */
  private write(cells: readonly { readonly row: number; readonly column: number; readonly value: string }[]): boolean {
    const changes = cells
      .map((cell) => ({ row: cell.row, column: cell.column, before: this.cell(cell.row, cell.column), after: cell.value }))
      .filter((change) => change.before !== change.after);
    if (changes.length === 0) {
      return false;
    }
    this.apply(changes, 'after');
    this.undoStack.push({ cells: changes });
    if (this.undoStack.length > UNDO_DEPTH) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    return true;
  }

  private replay(from: UiSheetPatch[], to: UiSheetPatch[], side: 'before' | 'after'): boolean {
    const patch = from.pop();
    if (patch === undefined || !this.editable()) {
      return false;
    }
    this.apply(patch.cells, side);
    to.push(patch);
    const first = patch.cells[0] as UiCell;
    const last = patch.cells.at(-1) as UiCell;
    this.active.set({ row: first.row, column: first.column });
    this.corner.set({ row: last.row, column: last.column });
    return true;
  }

  private apply(cells: readonly (UiCell & { readonly before: string; readonly after: string })[], side: 'before' | 'after'): void {
    const rows = [...this.data()];
    const width = this.dataColumns();
    for (const cell of cells) {
      while (rows.length <= cell.row) {
        rows.push(Array<string>(width).fill(''));
      }
      const row = [...(rows[cell.row] as readonly string[])];
      while (row.length <= cell.column) {
        row.push('');
      }
      row[cell.column] = cell[side];
      rows[cell.row] = row;
    }
    // A column made by typing past the last one is every row's: no row is left a field short.
    const widest = Math.max(width, ...rows.map((row) => row.length));
    this.data.set(widest > width ? rows.map((row) => (row.length < widest ? [...row, ...Array<string>(widest - row.length).fill('')] : row)) : rows);
  }

  /** The selection, but no further than the data — a whole column of a sheet with an extra empty row is its data. */
  private clippedRange(): UiCellRange {
    const range = this.range();
    return {
      ...range,
      bottom: Math.min(range.bottom, Math.max(range.top, this.dataRows() - 1)),
      right: Math.min(range.right, Math.max(range.left, this.dataColumns() - 1)),
    };
  }

  private within(cell: UiCell): UiCell {
    return {
      row: Math.min(this.rowCount() - 1, Math.max(0, cell.row)),
      column: Math.min(this.columnCount() - 1, Math.max(0, cell.column)),
    };
  }

  private clamp(): void {
    this.active.set(this.within(this.active()));
    this.corner.set(this.within(this.corner()));
  }
}
