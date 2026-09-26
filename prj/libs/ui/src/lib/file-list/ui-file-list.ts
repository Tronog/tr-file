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
import { UiIcon } from '../icon/ui-icon';
import { isTypeaheadKey, pageStep, UiTypeahead } from '../keyboard/list-navigation';
import type { UiFileColumn, UiFileRow, UiPanelKey } from '../models';
import { UiVirtualViewport, VIRTUAL_THRESHOLD, visibleRange } from '../virtual/ui-virtual-viewport';

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
 * onto a row emits `select`, which is what makes the details sidebar track the
 * keyboard the same way it tracks the mouse.
 *
 * The keys that mean something to the *workbench* rather than to this table
 * — `Enter`, `Space`, `Backspace`, `F5` — leave as a `UiPanelKey` instead of
 * being acted on here; `PanelKeyboardFeature` in the app decides what each one
 * does.
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

  /** Double click: open the entry. */
  readonly activate = output<string>();

  /** Single click / arrow key: make the entry the selection. */
  readonly select = output<string>();

  /** A key whose meaning is the application's; see `UiPanelKey`. */
  readonly command = output<UiPanelKey>();

  /** A tree row's twisty was clicked, or `→`/`←` opens or closes it. */
  readonly toggle = output<string>();

  /** The one row that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const rows = this.rows();
    return (rows.find((row) => row.focused) ?? rows[0])?.id ?? null;
  });

  /** Keys documented on every row, so the set is discoverable. */
  protected readonly keyShortcuts = 'Enter Space Backspace F5 PageUp PageDown Home End';

  private readonly rowElements = viewChildren<ElementRef<HTMLTableRowElement>>('rowElement');
  private readonly body = viewChild<ElementRef<HTMLTableSectionElement>>('body');

  private readonly typeahead = new UiTypeahead();

  private readonly viewport = new UiVirtualViewport();
  private readonly rowHeight = signal(DEFAULT_ROW_HEIGHT);
  /** Where the first row starts inside the scroll content — below the header. */
  private readonly leading = signal(0);

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

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => this.viewport.attach(host));
    inject(DestroyRef).onDestroy(() => this.viewport.dispose());

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

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const rows = this.rows();
    const row = rows[index];
    if (!row) {
      return;
    }

    // `Alt` and `Ctrl` belong to the panel, not to the table: its history and
    // its `Up` (PRD 001, §6.2.1, §6.2.3), and switching tabs with
    // `Ctrl`+`PageUp`/`PageDown` (§6.2.4). `UiFileBrowser` and `UiPanelGroup`
    // listen for them, so a chord must not also move the cursor here on its
    // way past.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(index + 1);
        break;
      case 'ArrowUp':
        this.focusRow(index - 1);
        break;
      case 'Home':
        this.focusRow(0);
        break;
      case 'End':
        this.focusRow(rows.length - 1);
        break;
      case 'PageDown':
        this.focusRow(index + this.page());
        break;
      case 'PageUp':
        this.focusRow(index - this.page());
        break;
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
      case 'Enter':
        this.command.emit({ command: 'open', entryId: row.id });
        break;
      case ' ':
        this.command.emit({ command: 'select', entryId: row.id });
        break;
      case 'Backspace':
        this.command.emit({ command: 'up', entryId: row.id });
        break;
      case 'F5':
        this.command.emit({ command: 'refresh', entryId: row.id });
        break;
      default: {
        if (!isTypeaheadKey(event)) {
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
   * Moves focus to a row and makes it the selection; indices are clamped. A
   * row that is not rendered is scrolled in first and focused after the next
   * render.
   */
  private focusRow(index: number): void {
    const rows = this.rows();
    const clamped = Math.min(Math.max(index, 0), rows.length - 1);
    const row = rows[clamped];
    if (!row) {
      return;
    }

    if (this.virtual()) {
      this.viewport.reveal(this.leading() + clamped * this.rowHeight(), this.rowHeight());
    }
    // By id, not by position: once the window has moved, the rendered rows are
    // the old window's until the next render.
    this.pendingFocusId = row.id;
    this.focusPending();
    this.select.emit(row.id);
  }

  /** Focuses the row a key moved to, if it is rendered yet. */
  private focusPending(): void {
    const id = this.pendingFocusId;
    if (id === null) {
      return;
    }
    const element = this.rowElements().find((candidate) => candidate.nativeElement.dataset['rowId'] === id);
    if (element) {
      element.nativeElement.focus();
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
