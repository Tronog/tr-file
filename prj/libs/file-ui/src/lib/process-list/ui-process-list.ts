import { Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { UiButton, UiEmptyState, UiIcon, UiIconButton, UiKeymap, UiSearchField, UiTypeahead, isTypeaheadKey, pageStep } from '@tr-file/ui';
import type { UiProcessListModel, UiProcessMenuRequest, UiProcessRow } from '../models';

/** The keymap's commands a process list answers on a row (`list`) and anywhere in it (`panel`). */
const ROW_COMMANDS = ['process.endTask', 'process.endTree'] as const;
const PANEL_COMMANDS = ['panel.contextMenu', 'edit.filter', 'view.refresh'] as const;

/** The DOM id of a row, for `aria-activedescendant`. */
let nextListId = 0;

/**
 * Windows 10 Task Manager's *Processes* tab (PRD 014, §2): a filter box and
 * a pause button above; a header whose measured columns show the whole
 * machine's load over their names; the processes under three headings —
 * *Apps*, *Background processes*, the system's — each app with its
 * processes folded under it; every number shaded by how loaded it is; and
 * *End task* below.
 *
 * Render-only: it is handed rows already grouped, sorted, formatted and
 * shaded, and reports what was asked — a row chosen, a group opened, a
 * column to sort by, a menu, *End task*.
 *
 * The keyboard stays on the list itself (`aria-activedescendant`), so the
 * rows can change under it every two seconds without taking focus away.
 * `↑` / `↓`, `Home` / `End` and the page keys move between rows — headings
 * are passed over — `→` opens a group or steps into it, `←` closes it or
 * steps out, `Enter` opens or closes, and letters find a row by its name:
 * navigation, so fixed. `Delete` (*End task*), `Shift`+`Delete` (*End
 * process tree*), the menu key, `Ctrl`+`F` (the filter box) and `Ctrl`+`R`
 * (update now) are the keymap's.
 */
@Component({
  selector: 'ui-process-list',
  imports: [UiButton, UiEmptyState, UiIcon, UiIconButton, UiSearchField],
  templateUrl: './ui-process-list.html',
  styleUrl: './ui-process-list.scss',
  host: {
    '[style.--process-columns]': 'gridColumns()',
  },
})
export class UiProcessList {
  readonly model = input.required<UiProcessListModel>();
  /** Bump to put the keyboard on the list; `0` never asks. */
  readonly focusToken = input<number>(0);
  /** Bump to put the keyboard in the filter box. */
  readonly filterFocus = input<number>(0);

  /** A row was chosen — clicked, or moved to with the keyboard. */
  readonly select = output<string>();
  /** A group to open or close. */
  readonly toggle = output<string>();
  /** A column header was clicked: sort by it (again, the other way round). */
  readonly sort = output<string>();
  readonly filterChange = output<string>();
  readonly pauseToggle = output<void>();
  readonly endTask = output<void>();
  readonly endTree = output<void>();
  readonly refresh = output<void>();
  /** A right-click or the menu key, on a row or on the header. */
  readonly contextMenu = output<UiProcessMenuRequest>();

  private readonly keymap = inject(UiKeymap);
  private readonly typeahead = new UiTypeahead();
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly listId = `ui-process-list-${nextListId++}`;
  private seenFocus = 0;
  /** A row moved to by the keyboard is scrolled into view once drawn. */
  private readonly reveal = signal<string | null>(null);

  /** Name grows to twice its width; what is left over stays empty at the right, as in Task Manager. */
  protected readonly gridColumns = computed(() =>
    [
      ...this.model().columns.map((column) => (column.id === 'name' ? `minmax(${column.width}px, ${column.width * 2}px)` : `${column.width}px`)),
      'minmax(0, 1fr)',
    ].join(' '),
  );

  /** The rows the keyboard can stand on: all but the headings. */
  private readonly stops = computed(() => this.model().rows.filter((row) => row.kind !== 'section'));

  protected readonly activeDescendant = computed(() => {
    const id = this.model().selectedId;
    return id === null || !this.model().rows.some((row) => row.id === id) ? null : this.domId(id);
  });

  constructor() {
    afterRenderEffect(() => {
      const token = this.focusToken();
      if (token !== this.seenFocus) {
        this.seenFocus = token;
        if (token > 0) {
          this.body()?.nativeElement.focus({ preventScroll: true });
          this.reveal.set(this.model().selectedId);
        }
      }
    });
    afterRenderEffect(() => {
      const id = this.reveal();
      const body = this.body()?.nativeElement;
      if (id === null || body === undefined) {
        return;
      }
      body.querySelector<HTMLElement>(`#${CSS.escape(this.domId(id))}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  protected domId(rowId: string): string {
    return `${this.listId}-${rowId.replace(/[^A-Za-z0-9_-]/g, (character) => `_${character.charCodeAt(0)}`)}`;
  }

  protected heatOf(heat: number | undefined): string | null {
    return heat === undefined ? null : String(Math.max(0, Math.min(1, heat)));
  }

  protected sortIcon(sort: 'asc' | 'desc' | undefined): 'chevron-down' | 'chevrons-up' | null {
    return sort === undefined ? null : sort === 'desc' ? 'chevron-down' : 'chevrons-up';
  }

  protected ariaSort(sort: 'asc' | 'desc' | undefined): string | null {
    return sort === undefined ? null : sort === 'asc' ? 'ascending' : 'descending';
  }

  protected onRowClick(row: UiProcessRow): void {
    if (row.kind === 'section') {
      return;
    }
    this.body()?.nativeElement.focus({ preventScroll: true });
    this.select.emit(row.id);
  }

  protected onRowDoubleClick(row: UiProcessRow): void {
    if (row.expandable) {
      this.toggle.emit(row.id);
    }
  }

  protected onTwisty(event: MouseEvent, row: UiProcessRow): void {
    event.stopPropagation();
    this.body()?.nativeElement.focus({ preventScroll: true });
    this.select.emit(row.id);
    this.toggle.emit(row.id);
  }

  protected onRowMenu(event: MouseEvent, row: UiProcessRow): void {
    event.preventDefault();
    if (row.kind === 'section') {
      return;
    }
    this.body()?.nativeElement.focus({ preventScroll: true });
    this.select.emit(row.id);
    this.contextMenu.emit({ target: row.id, x: event.clientX, y: event.clientY });
  }

  protected onHeaderMenu(event: MouseEvent): void {
    event.preventDefault();
    this.contextMenu.emit({ target: 'header', x: event.clientX, y: event.clientY });
  }

  protected onFilter(value: string): void {
    this.filterChange.emit(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    const inField = UiProcessList.isTextField(event.target);
    const panel = this.keymap.commandFor(event, 'panel', PANEL_COMMANDS);
    if (panel === 'edit.filter') {
      event.preventDefault();
      this.focusFilter();
      return;
    }
    if (inField) {
      // `↓` from the filter box goes to the list, as from a search field in a file manager.
      if (event.key === 'ArrowDown' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        this.body()?.nativeElement.focus();
        this.move(this.selectedIndex() === -1 ? 0 : this.selectedIndex());
      }
      return;
    }
    if (panel === 'view.refresh') {
      event.preventDefault();
      this.refresh.emit();
      return;
    }
    if (panel === 'panel.contextMenu') {
      event.preventDefault();
      this.openMenuAtSelection();
      return;
    }
    if (!this.isOnBody(event.target)) {
      return;
    }
    const command = this.keymap.commandFor(event, 'list', ROW_COMMANDS);
    if (command !== null) {
      event.preventDefault();
      (command === 'process.endTask' ? this.endTask : this.endTree).emit();
      return;
    }
    this.navigate(event);
  }

  /** The fixed keys of a tree list. */
  private navigate(event: KeyboardEvent): void {
    const stops = this.stops();
    if (stops.length === 0 || event.altKey || event.metaKey || (event.ctrlKey && event.key !== 'Home' && event.key !== 'End')) {
      return;
    }
    const at = this.selectedIndex();
    const current = at === -1 ? undefined : stops[at];
    const page = () => pageStep(this.body()?.nativeElement.querySelector<HTMLElement>('[data-row]') ?? undefined);
    switch (event.key) {
      case 'ArrowDown':
        this.move(at === -1 ? 0 : at + 1);
        break;
      case 'ArrowUp':
        this.move(at === -1 ? 0 : at - 1);
        break;
      case 'Home':
        this.move(0);
        break;
      case 'End':
        this.move(stops.length - 1);
        break;
      case 'PageDown':
        this.move(at === -1 ? 0 : at + page());
        break;
      case 'PageUp':
        this.move(at === -1 ? 0 : at - page());
        break;
      case 'ArrowRight':
        if (current?.expandable && !current.expanded) {
          this.toggle.emit(current.id);
        } else if (current?.expandable && current.expanded) {
          this.move(at + 1);
        }
        break;
      case 'ArrowLeft':
        if (current?.expandable && current.expanded) {
          this.toggle.emit(current.id);
        } else if (current !== undefined && current.level === 2) {
          // Up to the group it is in: the nearest row above that is not one of its processes.
          for (let index = at - 1; index >= 0; index -= 1) {
            if ((stops[index]?.level ?? 0) < 2) {
              this.move(index);
              break;
            }
          }
        }
        break;
      case 'Enter':
        if (current?.expandable) {
          this.toggle.emit(current.id);
        }
        break;
      default:
        if (isTypeaheadKey(event)) {
          const found = this.typeahead.match(
            event.key,
            stops.map((row) => row.label),
            at,
          );
          if (found !== -1) {
            this.move(found);
          }
          event.preventDefault();
        }
        return;
    }
    event.preventDefault();
  }

  private selectedIndex(): number {
    const id = this.model().selectedId;
    return id === null ? -1 : this.stops().findIndex((row) => row.id === id);
  }

  private move(index: number): void {
    const stops = this.stops();
    const row = stops[Math.max(0, Math.min(stops.length - 1, index))];
    if (row !== undefined) {
      this.select.emit(row.id);
      this.reveal.set(null);
      this.reveal.set(row.id);
    }
  }

  private openMenuAtSelection(): void {
    const id = this.model().selectedId;
    const body = this.body()?.nativeElement;
    const element = id === null ? null : (body?.querySelector<HTMLElement>(`#${CSS.escape(this.domId(id))}`) ?? null);
    const box = (element ?? body)?.getBoundingClientRect();
    if (id === null || box === undefined) {
      return;
    }
    this.contextMenu.emit({ target: id, x: box.left + 24, y: box.bottom });
  }

  private readonly field = viewChild(UiSearchField);

  private focusFilter(): void {
    this.field()?.focus();
  }

  private isOnBody(target: EventTarget | null): boolean {
    return target === this.body()?.nativeElement;
  }

  private static isTextField(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
  }
}
