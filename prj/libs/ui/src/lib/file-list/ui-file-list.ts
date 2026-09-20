import { Component, computed, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiFileColumn, UiFileRow } from '../models';

/**
 * The "details" view of a directory: a real `<table>` so screen readers get
 * row/column semantics for free.
 *
 * The first column always renders the name cell (icon + git-decorated name);
 * every other column looks its text up in `row.cells` by the column key, which
 * keeps the column set fully data driven.
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

  /** Double click / Enter: open the entry. */
  readonly activate = output<string>();

  /** Single click: make the entry the selection. */
  readonly select = output<string>();

  /** The one row that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const rows = this.rows();
    return (rows.find((row) => row.focused) ?? rows[0])?.id ?? null;
  });

  protected ariaSort(column: UiFileColumn): string | null {
    if (column.sort === 'asc') {
      return 'ascending';
    }
    return column.sort === 'desc' ? 'descending' : null;
  }

  protected sortIcon(column: UiFileColumn): 'chevron-down' | 'chevrons-up' {
    return column.sort === 'desc' ? 'chevron-down' : 'chevrons-up';
  }

  protected onKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.activate.emit(id);
    }
  }
}
