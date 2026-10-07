import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  clickMode,
  isTypeaheadKey,
  moveMode,
  pageStep,
  UiIcon,
  UiKeymap,
  UiListSelection,
  UiTypeahead,
  UiVirtualViewport,
  VIRTUAL_THRESHOLD,
  visibleRange,
  type UiSelectionChange,
  type UiSelectMode,
} from '@tr-file/ui';
import { isBoundAbove, isPanelCharacter, LIST_PANEL_KEYS, listCommandFor, listKeyShortcuts, type UiListCommand } from '../keyboard/list-keys';
import type { UiFileColumn, UiFileRow, UiPanelKey } from '../models';

/** A row's height until one has been measured: `--vsc-row-height`. */
const DEFAULT_ROW_HEIGHT = 22;

/**
 * The "details" view of a directory: a real `<table>` so screen readers get
 * row/column semantics for free.
 *
 * The first column always renders the name cell (icon + git-decorated name);
 * every other column looks its text up in `row.cells` by the column key, which
 * keeps the column set fully data driven.
 *
 * Keyboard (PRD 001, Section 6.2) is the traditional file-manager set rather
 * than the bare ARIA grid one: `↑`/`↓`, `Home`/`End` and `PageUp`/`PageDown`
 * move, and typing letters jumps to a name. Selection follows focus — moving
 * onto a row selects it, which is what makes the details sidebar track the
 * keyboard the same way it tracks the mouse.
 *
 * Focus handed to the table from outside while nothing is selected lands on
 * the first row, which takes the cursor but is not selected (PRD 002, §3.1;
 * PRD 004, §1.3.3); see `onFocusArrived`.
 *
 * Selection is multiple (PRD 004, §1.2; see `UiListSelection`): `Ctrl`/`⌘`
 * click toggles a row, `Shift` click selects the range from the anchor, and
 * with the keyboard `Shift` plus a movement key extends, `Ctrl` plus an arrow
 * moves the cursor alone, `Ctrl`+`Space` toggles and `Ctrl`+`A` selects all.
 * Midnight Commander's keys work too (PRD 004, §2): `Insert` marks the row and
 * moves on, `*` selects everything or, once everything is, nothing. Every
 * change leaves as one `selectionChange`; `select` still names the row the
 * cursor landed on.
 *
 * The keys that mean something to the *workbench* rather than to this table
 * — `Enter`, `Space`, `Backspace`, `Delete` (`Shift`+`Delete` deletes for
 * good), and `+` / `-` (select or unselect by a pattern) — leave as a
 * `UiPanelKey` instead of being acted on here; `PanelKeyboardFeature` in the
 * app decides what each one does. The function keys are the window's, not
 * the table's.
 *
 * With `sortable` set the column headers are buttons that report `sort` with
 * their column's key (PRD 003, §5); the order is the application's, and the
 * header marked `sort` on its column says what it is. Once the rows are drawn
 * in the new order the keyboard goes back to them rather than staying on the
 * header (PRD 002, §3.1): to the cursor's row, wherever it moved to — or, with
 * nothing selected, to the first row, which takes the cursor alone.
 *
 * With `tree` set the same table is a tree grid (PRD 002, §4.1): the rows are
 * a pre-flattened tree — `depth`, `expandable`, `expanded` already describe
 * its shape, so the component never walks a hierarchy — and the name cell
 * indents and gains a twisty. The columns, the selection and every key above
 * stay as they are; `→` opens a folder (or steps into an open one) and `←`
 * closes it (or steps out to its parent), as in the explorer tree. Opening and
 * closing are reported through `toggle`; what is inside a folder is the
 * application's to fetch.
 *
 * A long listing renders only the rows near the viewport (PRD 003, §1), with
 * a spacer row above and below standing in for the rest; see
 * `UiVirtualViewport`. Every key still works across the whole list: a move to
 * a row that is not rendered scrolls it in and focuses it once it is, and the
 * tab stop is always a rendered row.
 */
@Component({
  selector: 'ui-file-list',
  imports: [UiIcon],
  templateUrl: './ui-file-list.html',
  styleUrl: './ui-file-list.scss',
})
export class UiFileList {
  readonly columns = input.required<readonly UiFileColumn[]>();
  readonly rows = input.required<readonly UiFileRow[]>();

  /** Accessible name of the table. */
  readonly label = input<string>('Files');

  /** Render the rows as a tree grid; see the class comment. */
  readonly tree = input<boolean>(false);

  /** Rows may be dragged (PRD 005, §2); `UiFileBrowser` handles the drag. */
  readonly draggable = input(false);

  /** The folder row a drag is over, lit as the drop target. */
  readonly dropTargetId = input<string | null>(null);

  /** Double click: open the entry. */
  readonly activate = output<string>();

  /** `Ctrl`+double click: open the entry in the other panel (PRD 002, §2.5). */
  readonly activateAside = output<string>();

  /** The row a click or a key made current. */
  readonly select = output<string>();

  /** The whole selection after a click or a key; see `UiSelectionChange`. */
  readonly selectionChange = output<UiSelectionChange>();

  /** A key whose meaning is the application's; see `UiPanelKey`. */
  readonly command = output<UiPanelKey>();

  /** A tree row's twisty was clicked, or `→`/`←` opens or closes it. */
  readonly toggle = output<string>();

  /** Column headers are buttons that ask for the listing to be sorted by them. */
  readonly sortable = input(false);

  /** A column header was clicked: sort by this column's key (or turn its order round). */
  readonly sort = output<string>();

  /** The row the application has the cursor on, if any. */
  private readonly cursorId = computed(() => this.rows().find((row) => row.focused)?.id ?? null);

  /** The one row that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => this.cursorId() ?? this.rows()[0]?.id ?? null);

  /** The cursor last drawn; see the constructor. */
  private drawnCursorId: string | null | undefined;

  /** Keys documented on every row, so the set is discoverable. */
  protected readonly keyShortcuts = computed(() => `${listKeyShortcuts(this.keymap)} PageUp PageDown Home End`);

  /** The key bindings in force (PRD 010, §2). */
  private readonly keymap = inject(UiKeymap);

  private readonly rowElements = viewChildren<ElementRef<HTMLTableRowElement>>('rowElement');
  private readonly body = viewChild<ElementRef<HTMLTableSectionElement>>('body');

  private readonly typeahead = new UiTypeahead();
  private readonly selection = new UiListSelection();

  private readonly viewport = new UiVirtualViewport();
  private readonly rowHeight = signal(DEFAULT_ROW_HEIGHT);
  /** Where the first row starts inside the scroll content — below the header. */
  private readonly leading = signal(0);

  /** A header was pressed to sort: focus goes back to the cursor's row after the next render. */
  private readonly refocusAfterSort = signal(false);

  /** A row a key moved to before it was rendered; focused once it is. */
  private pendingFocusId: string | null = null;

  /** Whether this listing is long enough to render only part of. */
  protected readonly virtual = computed(() => this.rows().length >= VIRTUAL_THRESHOLD);

  /** The rows rendered: all of them, or those near the viewport. */
  protected readonly range = computed(() => {
    const total = this.rows().length;
    if (!this.virtual()) {
      return { start: 0, end: total };
    }
    return visibleRange({
      total,
      lineHeight: this.rowHeight(),
      perLine: 1,
      scrollTop: this.viewport.scrollTop(),
      viewportHeight: this.viewport.viewportHeight(),
      leading: this.leading(),
    });
  });

  protected readonly visibleRows = computed(() => {
    const { start, end } = this.range();
    return this.rows().slice(start, end);
  });

  /** Spacer heights standing in for the rows above and below the window. */
  protected readonly spaceAbove = computed(() => this.range().start * this.rowHeight());
  protected readonly spaceBelow = computed(() => (this.rows().length - this.range().end) * this.rowHeight());

  /**
   * The single tab stop: the focused row when it is rendered, else the first
   * row that is — a list scrolled away from its cursor must still be reachable.
   */
  protected readonly tabStopId = computed(() => {
    const focusId = this.focusId();
    const visible = this.visibleRows();
    return visible.some((row) => row.id === focusId) ? focusId : (visible[0]?.id ?? null);
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    afterNextRender(() => this.viewport.attach(this.host));
    inject(DestroyRef).onDestroy(() => this.viewport.dispose());

    // After a sort (PRD 002, §3.1): the rows are in their new order by now,
    // since the application re-sorts as the header reports it.
    afterRenderEffect(() => {
      if (!this.refocusAfterSort()) {
        return;
      }
      this.refocusAfterSort.set(false);
      // With nothing selected there is no place to go back to: the first row
      // takes the cursor, and still nothing is selected (PRD 004, §1.3.3).
      if (this.selectedIds().size === 0) {
        this.focusRow(0, 'focus');
        return;
      }
      const index = this.rows().findIndex((row) => row.id === this.focusId());
      if (index !== -1) {
        this.moveFocus(index);
      }
    });

    // A cursor the application moved while the keyboard is elsewhere — an
    // image stepped through in the panel it was opened from (PRD 012, §1.1.1)
    // — is scrolled into view; focus stays where it is.
    afterRenderEffect(() => {
      const cursor = this.cursorId();
      const moved = this.drawnCursorId !== undefined && cursor !== this.drawnCursorId;
      this.drawnCursorId = cursor;
      if (!moved || cursor === null || this.host.contains(document.activeElement)) {
        return;
      }
      const index = this.rows().findIndex((row) => row.id === cursor);
      if (this.virtual()) {
        this.viewport.reveal(this.leading() + index * this.rowHeight(), this.rowHeight());
      } else {
        this.rowElements()
          .find((element) => element.nativeElement.dataset['rowId'] === cursor)
          ?.nativeElement.scrollIntoView?.({ block: 'nearest' });
      }
    });

    // After each render of a long list: measure what the window is computed
    // from, and hand focus to a row a key moved to while it was off-screen.
    afterRenderEffect(() => {
      this.range();
      if (!this.virtual()) {
        return;
      }
      const first = this.rowElements()[0]?.nativeElement;
      if (first !== undefined && first.offsetHeight > 0) {
        this.rowHeight.set(first.offsetHeight);
      }
      const body = this.body()?.nativeElement;
      if (body !== undefined) {
        this.leading.set(this.viewport.offsetOf(body));
      }
      this.focusPending();
    });
  }

  /** A header asks for the listing sorted by its column; see the class comment for where focus goes. */
  protected onSort(key: string): void {
    this.sort.emit(key);
    this.refocusAfterSort.set(true);
  }

  protected ariaSort(column: UiFileColumn): string | null {
    if (column.sort === 'asc') {
      return 'ascending';
    }
    return column.sort === 'desc' ? 'descending' : null;
  }

  protected sortIcon(column: UiFileColumn): 'chevron-down' | 'chevrons-up' {
    return column.sort === 'desc' ? 'chevron-down' : 'chevrons-up';
  }

  /**
   * The twisty is its own target: a click on it must neither select the row
   * nor, twice in a row, open it — it only folds.
   */
  protected onTwisty(event: Event, row: UiFileRow): void {
    event.stopPropagation();
    if (event.type === 'click') {
      this.toggle.emit(row.id);
    }
  }

  /**
   * Focus arrived on a row from outside — the panel handing the keyboard
   * to its content (a click on its blank space, a tab chosen, `Tab` from
   * another panel, a folder entered), a sort — while nothing is selected
   * (PRD 002, §3.1): the first row takes the cursor, and nothing is selected
   * — opening a folder picks nothing in it, so the details go on describing
   * the folder (PRD 004, §1.3.3). A pointer press selects by its own rules, and a move of this
   * component's own (`Ctrl`+arrow, `Insert`) has already said what it means.
   */
  protected onFocusArrived(): void {
    if (this.movingFocus || this.pressing) {
      this.pressing = false;
      return;
    }
    if (this.selectedIds().size === 0) {
      this.focusRow(0, 'focus');
    }
  }

  /** Set while this component moves focus itself; see `onFocusArrived`. */
  private movingFocus = false;

  /** Set from a pointer press on a row until it is released; see `onFocusArrived`. */
  protected pressing = false;

  /** A click selects by the keys held: alone, toggled, or as a range. */
  protected onClick(event: MouseEvent, index: number): void {
    const row = this.rows()[index];
    if (row) {
      this.pick(row.id, clickMode(event));
    }
  }

  /** A double click opens its entry — with `Ctrl` (`Cmd`), in the other panel. */
  protected onDoubleClick(event: MouseEvent, id: string): void {
    if (event.ctrlKey || event.metaKey) {
      this.activateAside.emit(id);
    } else {
      this.activate.emit(id);
    }
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const rows = this.rows();
    const row = rows[index];
    if (!row) {
      return;
    }

    // A key bound to a list command (PRD 010, §2) — see `UI_DEFAULT_KEYBINDINGS`.
    const bound = listCommandFor(this.keymap, event, this.typeahead.typing());
    if (bound !== null) {
      this.runBound(bound, index);
      event.preventDefault();
      return;
    }

    // `Alt` belongs to the panel, not to the table: its history and its `Up`
    // (PRD 001, §6.2.1, §6.2.3). So do the other `Ctrl` chords — switching
    // tabs with `Ctrl`+`PageUp`/`PageDown` (§6.2.4), `Ctrl`+`Enter`, `Ctrl`+`T`
    // — and `UiFileBrowser` and `UiPanelGroup` listen for them, so they must
    // not also move the cursor here on their way past.
    if (event.altKey) {
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    // A `Ctrl` chord the panel binds — `Ctrl`+`↑` maximizes it (PRD 002, §2.8) — is not a cursor move.
    if (command && isBoundAbove(this.keymap, event)) {
      return;
    }

    const target = this.movementTarget(event.key, index);
    if (target !== null) {
      if (command && (event.key === 'PageUp' || event.key === 'PageDown')) {
        return;
      }
      this.focusRow(target, moveMode(event));
      event.preventDefault();
      return;
    }

    if (command) {
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        if (!this.tree()) {
          return;
        }
        // A closed folder opens; an open one steps into its first child.
        if (row.expandable && !row.expanded) {
          this.toggle.emit(row.id);
        } else if (row.expandable) {
          this.focusRow(index + 1);
        }
        break;
      case 'ArrowLeft':
        if (!this.tree()) {
          return;
        }
        // An open folder closes; anything else steps out to its parent.
        if (row.expandable && row.expanded) {
          this.toggle.emit(row.id);
        } else {
          this.focusParent(index);
        }
        break;
      default: {
        if (!isTypeaheadKey(event) || isPanelCharacter(this.keymap, event, this.typeahead.typing())) {
          return;
        }
        const found = this.typeahead.match(
          event.key,
          rows.map((candidate) => candidate.name),
          index,
        );
        if (found === -1) {
          // Still claim the key: an unmatched letter must not reach the
          // browser's own find-as-you-type.
          break;
        }
        this.focusRow(found);
        break;
      }
    }

    event.preventDefault();
  }

  /**
   * A bound list command on row `index`: one of the application's, reported
   * as a `UiPanelKey`, or a selection gesture made here — `Ctrl`+`A`,
   * `Ctrl`+`Space`, and Midnight Commander's `Insert` and `*` (PRD 004, §2).
   * `Insert` on the last row marks it and stays, as there.
   */
  private runBound(command: UiListCommand, index: number): void {
    const rows = this.rows();
    const row = rows[index] as UiFileRow;
    const panelKey = LIST_PANEL_KEYS[command];
    if (panelKey !== undefined) {
      this.command.emit({ command: panelKey, entryId: row.id });
      return;
    }
    switch (command) {
      case 'selection.all':
        this.pick(row.id, 'all');
        break;
      case 'list.toggleSelection':
        this.pick(row.id, 'toggle');
        break;
      case 'list.toggleAll':
        this.pick(row.id, 'toggle-all');
        break;
      case 'list.mark': {
        const next = Math.min(index + 1, rows.length - 1);
        const change = this.selection.mark({
          ids: rows.map((candidate) => candidate.id),
          selected: this.selectedIds(),
          target: row.id,
          next: (rows[next] as UiFileRow).id,
        });
        this.moveFocus(next);
        this.report(change);
        break;
      }
      default:
        break;
    }
  }

  /** Where a movement key goes from `index`, or `null` for any other key. */
  private movementTarget(key: string, index: number): number | null {
    switch (key) {
      case 'ArrowDown':
        return index + 1;
      case 'ArrowUp':
        return index - 1;
      case 'Home':
        return 0;
      case 'End':
        return this.rows().length - 1;
      case 'PageDown':
        return index + this.page();
      case 'PageUp':
        return index - this.page();
      default:
        return null;
    }
  }

  /** Applies a selection gesture to `id` and reports the result. */
  private pick(id: string, mode: UiSelectMode): void {
    this.report(
      this.selection.pick({
        ids: this.rows().map((row) => row.id),
        selected: this.selectedIds(),
        cursor: this.focusId(),
        target: id,
        mode,
      }),
    );
  }

  private report(change: UiSelectionChange): void {
    this.selectionChange.emit(change);
    if (change.focused !== null) {
      this.select.emit(change.focused);
    }
  }

  private selectedIds(): ReadonlySet<string> {
    return new Set(this.rows().filter((row) => row.selected || row.inactiveSelected).map((row) => row.id));
  }

  /**
   * Moves focus to a row and selects by `mode` — the row alone unless told
   * otherwise; indices are clamped.
   */
  private focusRow(index: number, mode: UiSelectMode = 'replace'): void {
    const row = this.moveFocus(index);
    if (row !== undefined) {
      this.pick(row.id, mode);
    }
  }

  /**
   * Moves focus to a row, selecting nothing; indices are clamped. A row that
   * is not rendered is scrolled in first and focused after the next render.
   */
  private moveFocus(index: number): UiFileRow | undefined {
    const rows = this.rows();
    const clamped = Math.min(Math.max(index, 0), rows.length - 1);
    const row = rows[clamped];
    if (!row) {
      return undefined;
    }

    if (this.virtual()) {
      this.viewport.reveal(this.leading() + clamped * this.rowHeight(), this.rowHeight());
    }
    // By id, not by position: once the window has moved, the rendered rows are
    // the old window's until the next render.
    this.pendingFocusId = row.id;
    this.focusPending();
    return row;
  }

  /** Focuses the row a key moved to, if it is rendered yet. */
  private focusPending(): void {
    const id = this.pendingFocusId;
    if (id === null) {
      return;
    }
    // Focus gone elsewhere meanwhile — the path bar, another panel — is the
    // user's: a render while a large folder streams in must not take it back.
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && !this.host.contains(focused)) {
      this.pendingFocusId = null;
      return;
    }
    const element = this.rowElements().find((candidate) => candidate.nativeElement.dataset['rowId'] === id);
    if (element) {
      this.movingFocus = true;
      try {
        element.nativeElement.focus();
      } finally {
        this.movingFocus = false;
      }
      this.pendingFocusId = null;
    }
  }

  /** The nearest row above that sits one level shallower, if there is one. */
  private focusParent(index: number): void {
    const rows = this.rows();
    const depth = rows[index]?.depth ?? 0;
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      if ((rows[candidate]?.depth ?? 0) < depth) {
        this.focusRow(candidate);
        return;
      }
    }
  }

  private page(): number {
    return pageStep(this.rowElements()[0]?.nativeElement);
  }
}
