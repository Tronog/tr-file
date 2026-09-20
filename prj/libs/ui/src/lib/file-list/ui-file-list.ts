import { Component, computed, input, output, viewChildren, type ElementRef } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { isTypeaheadKey, pageStep, UiTypeahead } from '../keyboard/list-navigation';
import type { UiFileColumn, UiFileRow, UiPanelKey } from '../models';

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

  /** Double click: open the entry. */
  readonly activate = output<string>();

  /** Single click / arrow key: make the entry the selection. */
  readonly select = output<string>();

  /** A key whose meaning is the application's; see `UiPanelKey`. */
  readonly command = output<UiPanelKey>();

  /** The one row that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const rows = this.rows();
    return (rows.find((row) => row.focused) ?? rows[0])?.id ?? null;
  });

  /** Keys documented on every row, so the set is discoverable. */
  protected readonly keyShortcuts = 'Enter Space Backspace F5 PageUp PageDown Home End';

  private readonly rowElements = viewChildren<ElementRef<HTMLTableRowElement>>('rowElement');

  private readonly typeahead = new UiTypeahead();

  protected ariaSort(column: UiFileColumn): string | null {
    if (column.sort === 'asc') {
      return 'ascending';
    }
    return column.sort === 'desc' ? 'descending' : null;
  }

  protected sortIcon(column: UiFileColumn): 'chevron-down' | 'chevrons-up' {
    return column.sort === 'desc' ? 'chevron-down' : 'chevrons-up';
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const rows = this.rows();
    const row = rows[index];
    if (!row) {
      return;
    }

    // `Alt` and `Ctrl` belong to the panel, not to the table: its history and
    // its `Up` (PRD 001, §6.2.1, §6.2.3), and switching tabs with
    // `Ctrl`+`PageUp`/`PageDown` (§6.2.4). `UiPanelGroup` listens for them, so
    // a chord must not also move the cursor here on its way past.
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

  /** Moves focus to a row and makes it the selection; indices are clamped. */
  private focusRow(index: number): void {
    const rows = this.rows();
    const clamped = Math.min(Math.max(index, 0), rows.length - 1);
    const row = rows[clamped];
    if (!row) {
      return;
    }

    this.rowElements()[clamped]?.nativeElement.focus();
    this.select.emit(row.id);
  }

  private page(): number {
    return pageStep(this.rowElements()[0]?.nativeElement);
  }
}
