import { Component, afterRenderEffect, computed, inject, input, output, signal, viewChild, type ElementRef } from '@angular/core';
import { type UiJsonEdit, UiBreadcrumbs, UiSearchField, UiSegmented, type UiSegmentedOption, UiDocumentView, UiEmptyState, UiKeymap, UiPanelBody, UiPanelToolbar, type UiContextMenuRequest, type UiFilesDrop, type UiSelectionChange } from '@tr-file/ui';
import { UiFileList } from '../file-list/ui-file-list';
import { UiIconView } from '../icon-view/ui-icon-view';
import { UI_ENTRY_MIME, type UiEntryDrop, type UiFileBrowserModel, type UiPanelKey, type UiPanelView } from '../models';

/** An entry of whichever view is showing, as far as dragging needs it. */
interface DragEntry {
  readonly id: string;
  readonly selected?: boolean;
  readonly inactiveSelected?: boolean;
  readonly dropTarget?: boolean;
}

/** The clipboard chords, by key. */
/** The panel commands the browser answers from anywhere in it; see `onKeydown`. */
const PANEL_COMMANDS = [
  'file.openToSide',
  'edit.copy',
  'edit.cut',
  'edit.paste',
  'edit.filter',
  'go.location',
  'edit.undo',
  'file.newFolder',
  'view.refresh',
  'file.copyPath',
  'panel.contextMenu',
  'image.previous',
  'image.next',
  'viewer.close',
  'view.stopLoading',
  'selection.clear',
] as const;

/** The panel commands that walk from folder to folder; see `onBodyKeydown`. */
const WALK_COMMANDS = ['go.back', 'go.forward', 'go.up'] as const;

/**
 * File-management content for a panel: a path bar, a toolbar, and a body
 * that is a listing (list or grid) or one file rendered read-only.
 *
 * The listing is a details table (`list`), large icons (`grid`), or the
 * details table as a tree whose folders open in place (`tree`, PRD 002 §4.1).
 *
 * Meant to be projected into a `UiPanelGroup`, which frames it — tab bar,
 * loading rail, drop targets — and asks it for focus through the body it
 * marks with `uiPanelBody`. Every chrome row is conditional on the data: the
 * path bar appears only when there are crumbs, the toolbar only when it has
 * something to show. The view switch is stateless: it renders `browser().view`
 * and re-emits changes through `viewChange`.
 *
 * Keys that mean something to the workbench leave as a `UiPanelKey`; the list
 * and the grid report theirs, and the browser adds the ones that are about the
 * listing as a whole rather than one row in it — among them the clipboard,
 * `Ctrl`+`C` / `X` / `V` (PRD 005, §2).
 *
 * Entries can be dragged — onto a folder in the listing, or to another
 * browser, onto a folder there or its blank space — and a drop is reported as
 * a `UiEntryDrop`.
 *
 * PRD 003, §5 adds what every file manager has, each reported rather than
 * acted on: `contextMenu` for a right-click (or `Shift`+`F10`) on an entry or
 * on blank space — an entry that was not selected is selected first, as file
 * managers do; `sortChange` from the column headers when `sortable`;
 * `filterChange` from the toolbar's filter box (`Ctrl`+`F` goes there,
 * `Escape` clears it, `↓` goes back to the listing); `pathSubmit` from the
 * path bar made editable by `location` (`Ctrl`+`L`); and the mouse's own
 * back and forward buttons, as `back` / `forward` panel keys. The drag is one for the page's own drag and drop, typed
 * `UI_ENTRY_MIME`, so it passes between panels and nothing else takes it.
 */
@Component({
  selector: 'ui-file-browser',
  imports: [
    UiBreadcrumbs,
    UiPanelToolbar,
    UiSegmented,
    UiSearchField,
    UiPanelBody,
    UiDocumentView,
    UiEmptyState,
    UiFileList,
    UiIconView,
  ],
  templateUrl: './ui-file-browser.html',
  styleUrl: './ui-file-browser.scss',
  host: { '(keydown)': 'onKeydown($event)', '(mouseup)': 'onMouseUp($event)' },
})
export class UiFileBrowser {
  readonly browser = input.required<UiFileBrowserModel>();

  readonly breadcrumbSelect = output<string>();
  readonly toolbarAction = output<string>();
  /** The text of a file being edited (PRD 005, §4), after each change. */
  readonly documentText = output<string>();
  /** A key or a value changed in a JSON file's tree (PRD 005, §5.2). */
  readonly documentJsonEdit = output<UiJsonEdit>();
  readonly viewChange = output<UiPanelView>();
  /**
   * A new selection in whichever view is showing — one entry or many
   * (PRD 004, §1.2).
   */
  readonly selectionChange = output<UiSelectionChange>();
  readonly rowActivate = output<string>();

  /** A folder in the tree view was opened or closed in place. */
  readonly rowToggle = output<string>();
  readonly itemActivate = output<string>();

  /** A key pressed inside the browser whose meaning is the application's. */
  readonly command = output<UiPanelKey>();

  /** Entries were dropped here — from this browser or another (PRD 005, §2). */
  readonly entryDrop = output<UiEntryDrop>();

  /**
   * Dragging an entry hands it to the operating system rather than to the
   * page (PRD 003, §6): the application starts a drag of *files* on
   * `nativeDragStart`, which other applications take — and which comes back
   * here as a `filesDrop` when dropped on a panel. The desktop, on its own
   * computer, sets it; a browser cannot drag files out.
   */
  readonly nativeDrag = input(false);

  /** A drag of these entries began, for the application to hand to the system; see `nativeDrag`. */
  readonly nativeDragStart = output<readonly string[]>();

  /**
   * Files from outside the page were dropped on a folder here, or on the
   * blank space of the listing (PRD 003, §6). The group around the browser
   * does not hear of them.
   */
  readonly filesDrop = output<UiFilesDrop>();

  /** The grid's tiles now on screen; see `UiIconView.shown`. */
  readonly itemsShown = output<readonly string[]>();

  /** A column header asked for the listing to be sorted by its key (PRD 003, §5). */
  readonly sortChange = output<string>();

  /** What the filter box now holds. */
  readonly filterChange = output<string>();

  /** A path typed into the path bar, confirmed with `Enter`. */
  readonly pathSubmit = output<string>();

  /** What the path bar holds as it is typed in — for `locationSuggestions` (PRD 004, §4.2). */
  readonly locationInput = output<string>();

  /** A right-click, `Shift`+`F10` or the menu key, on an entry or on blank space. */
  readonly contextMenu = output<UiContextMenuRequest>();

  /** The folder a drag is over, lit in the list or grid. */
  protected readonly dropTargetId = signal<string | null>(null);

  /** A drag is over blank space, so the listed folder itself is the target. */
  protected readonly bodyDropTarget = signal(false);

  /** What is being dragged out of *this* browser, while it is. */
  private dragging: ReadonlySet<string> | null = null;

  private readonly bodyElement = viewChild.required<ElementRef<HTMLElement>>('body');

  /** The key bindings in force (PRD 010, §2). */
  private readonly keymap = inject(UiKeymap);
  private readonly pathBar = viewChild(UiBreadcrumbs);
  private readonly filterField = viewChild(UiSearchField);

  /** The request tokens last answered; see `filterFocus` and `locationEdit`. */
  private seenFilterFocus: number | undefined;
  private seenLocationEdit: number | undefined;

  constructor() {
    // After render, so the box and the bar exist; the first value seen is
    // where the model started, not a request.
    afterRenderEffect(() => {
      const filterFocus = this.browser().filterFocus ?? 0;
      const locationEdit = this.browser().locationEdit ?? 0;
      if (this.seenFilterFocus !== undefined && filterFocus !== this.seenFilterFocus) {
        this.filterField()?.focus();
      }
      if (this.seenLocationEdit !== undefined && locationEdit !== this.seenLocationEdit) {
        this.pathBar()?.edit();
      }
      this.seenFilterFocus = filterFocus;
      this.seenLocationEdit = locationEdit;
    });
  }

  protected readonly viewOptions: readonly UiSegmentedOption[] = [
    { id: 'list', label: 'List view', icon: 'list' },
    { id: 'grid', label: 'Grid view', icon: 'layout-grid' },
    { id: 'tree', label: 'Tree view', icon: 'list-tree' },
  ];

  /**
   * Each panel's path bar is its own landmark, so they need distinct names —
   * duplicated landmark labels are indistinguishable to a screen reader. The
   * last crumb is what the tab is showing, and what the tab is called.
   */
  protected readonly breadcrumbLabel = computed(() => {
    const last = this.browser().breadcrumbs.at(-1);
    return last ? `Path of ${last.label}` : 'Path';
  });

  /**
   * A file is open, so the body is a read-only viewer rather than a listing.
   * `empty` still wins: that is how a file that cannot be shown says why.
   */
  protected readonly document = computed(() => {
    const browser = this.browser();
    return browser.empty ? undefined : browser.document;
  });

  /**
   * The list/grid switch is a choice about a directory listing, so a document
   * hides it — a file has no second view to offer.
   */
  protected readonly showViewSwitch = computed(
    () => !!this.browser().showViewSwitch && !this.document(),
  );

  protected readonly showToolbar = computed(() => {
    const browser = this.browser();
    return browser.toolbarActions.length > 0 || this.showViewSwitch() || !!browser.searchPlaceholder;
  });

  protected onViewChange(value: string): void {
    this.viewChange.emit(value === 'grid' || value === 'tree' ? value : 'list');
  }

  /**
   * The keys that are about the browser as a whole, from anywhere in it
   * (PRD 010, §2: each looked up in the keymap, `when: 'panel'`):
   *
   * - `Ctrl`+`Enter` opens what the cursor is on in a panel of its own
   *   (PRD 001, §6.2.5) — from a row, a tile, the document, the path bar;
   * - `Ctrl`+`C` / `X` / `V` copy, cut and paste entries (PRD 005, §2) — over
   *   a listing only, never in a text field or the document viewer, where the
   *   chords keep their usual meaning for text; copy and cut need an entry;
   * - the chords of PRD 003, §5: `Ctrl`+`F` to the filter box, `Ctrl`+`L` to
   *   the path bar, `Ctrl`+`Z` to undo, `Ctrl`+`Shift`+`N` for a new folder —
   *   and `Ctrl`+`R` to read the folder again (PRD 004, §2) and
   *   `Ctrl`+`Shift`+`C` to copy the full path of the entry focus is on, or of
   *   what the panel shows (PRD 004, §1.3.2);
   * - `Shift`+`F10` or the menu key: the context menu of the entry focus is
   *   on, beside it;
   * - `PageUp` / `PageDown` over an image: the previous or next image of its
   *   folder (PRD 012, §1.1);
   * - `Escape` while a large folder is being read: stop reading it (PRD 004,
   *   §3.1.4); over a file — text, markdown, a diff, an image: close its
   *   tab (PRD 005, §3.1; PRD 012, §1.3); else over a listing in additive
   *   selection mode, or with something selected: back to normal selection,
   *   nothing selected (PRD 004, §2.2) — only then; otherwise the key is left
   *   alone.
   *
   * None is claimed inside a text field. Handled before the key reaches the
   * group around it, which claims the tab chords. The browser knows which
   * entry has focus from its own model, so one handler covers the listing,
   * the tree and the grid alike.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (UiFileBrowser.isTextField(event.target)) {
      return;
    }
    // One key may be bound to several commands that each apply only sometimes (`Escape`).
    if (this.keymap.commandsFor(event, 'panel', PANEL_COMMANDS).some((command) => this.runPanelCommand(command))) {
      event.preventDefault();
    }
  }

  /** Carries out a panel command; `false` when it does not apply here, so the key is left alone. */
  private runPanelCommand(command: string): boolean {
    const listing = !this.document();
    const entryId = this.focusedEntry();
    switch (command) {
      case 'file.openToSide':
        if (entryId === null) {
          return false;
        }
        this.command.emit({ command: 'open-aside', entryId });
        return true;
      case 'edit.copy':
      case 'edit.cut':
        if (!listing || entryId === null) {
          return false;
        }
        this.command.emit({ command: command === 'edit.copy' ? 'copy' : 'cut', entryId });
        return true;
      case 'edit.paste':
        if (!listing) {
          return false;
        }
        this.command.emit({ command: 'paste', entryId });
        return true;
      case 'edit.filter':
        if (!listing || this.browser().searchPlaceholder === undefined) {
          return false;
        }
        this.filterField()?.focus();
        return true;
      case 'go.location':
        if (this.browser().location === undefined) {
          return false;
        }
        this.pathBar()?.edit();
        return true;
      case 'edit.undo':
        if (!listing) {
          return false;
        }
        this.command.emit({ command: 'undo', entryId: null });
        return true;
      case 'file.newFolder':
        if (!listing) {
          return false;
        }
        this.command.emit({ command: 'new-folder', entryId: null });
        return true;
      case 'view.refresh':
        this.command.emit({ command: 'refresh', entryId: null });
        return true;
      case 'file.copyPath':
        this.command.emit({ command: 'copy-path', entryId: listing ? entryId : null });
        return true;
      case 'panel.contextMenu': {
        if (!listing) {
          return false;
        }
        const anchor = document.activeElement instanceof HTMLElement ? document.activeElement : this.bodyElement().nativeElement;
        const rect = anchor.getBoundingClientRect();
        this.contextMenu.emit({ target: entryId, x: rect.left + 16, y: rect.top + Math.min(rect.height, 22) });
        return true;
      }
      case 'view.stopLoading':
        // Only while there is something to stop (PRD 004, §3.1.4); else `Escape` is not the browser's.
        if (!this.browser().stoppable) {
          return false;
        }
        this.command.emit({ command: 'stop-loading', entryId: null });
        return true;
      case 'image.previous':
      case 'image.next':
        // Over an image only (PRD 012, §1.1); in a listing the page keys move the cursor.
        if (this.document()?.kind !== 'image') {
          return false;
        }
        this.command.emit({ command: command === 'image.next' ? 'next-image' : 'previous-image', entryId: null });
        return true;
      case 'viewer.close':
        // Over a file only (PRD 005, §3.1; PRD 012, §1.3): its tab closes, back to the listing it came from.
        if (!this.document()) {
          return false;
        }
        this.command.emit({ command: 'close', entryId: null });
        return true;
      case 'selection.clear':
        // Over a listing in additive mode, or with something to deselect (PRD 004, §2.2).
        if (!listing || (this.browser().selectionMode !== 'additive' && !this.entries().some((entry) => entry.selected || entry.inactiveSelected))) {
          return false;
        }
        this.command.emit({ command: 'normal-selection', entryId });
        return true;
      default:
        return false;
    }
  }

  /**
   * The keys that are about the *folder* rather than what is selected in it,
   * wherever focus sits in the body: `Alt`+`←`/`→` walks the folders this
   * panel has visited (PRD 001, §6.2.1) and `Alt`+`↑` leaves the current one
   * for its parent (§6.2.3) — the *trail* and the *tree* are different
   * journeys, which is why they are different chords. They must work just as
   * well when the body is a document, or the empty-state placeholder, neither
   * of which has a keyboard of its own.
   *
   * `Go Up`'s list key (`Backspace`) is answered here *only* when the body
   * itself has focus, which is the empty-folder case: without it, a keyboard
   * user who walked into an empty folder would have no way to walk back out
   * of it. Whenever there is a row or a tile to stand on, the key belongs to
   * the view that owns it.
   */
  protected onBodyKeydown(event: KeyboardEvent): void {
    // The editor's text (PRD 005, §4) keeps its keys: `Alt`+arrows are a text field's.
    if (UiFileBrowser.isTextField(event.target)) {
      return;
    }
    const walk = this.keymap.commandFor(event, 'panel', WALK_COMMANDS);
    const up = event.target === this.bodyElement().nativeElement && this.keymap.commandFor(event, 'list', ['go.up']) !== null;
    if (walk === null && !up) {
      return;
    }
    this.command.emit({ command: walk === 'go.back' ? 'back' : walk === 'go.forward' ? 'forward' : 'up', entryId: null });
    event.preventDefault();
  }

  /**
   * A right-click in the body. On an entry that is not part of the selection,
   * that entry alone is selected first — the menu is about what was clicked.
   * A document keeps the browser's own menu, for copying its text.
   */
  protected onContextMenu(event: MouseEvent): void {
    if (this.document()) {
      return;
    }
    event.preventDefault();
    const id = UiFileBrowser.entryIdAt(event.target);
    if (id !== null) {
      const entry = this.entries().find((candidate) => candidate.id === id);
      if (entry !== undefined && !entry.selected && !entry.inactiveSelected) {
        this.selectionChange.emit({ selected: [id], focused: id });
      }
    }
    this.contextMenu.emit({ target: id, x: event.clientX, y: event.clientY });
  }

  /** The mouse's back and forward buttons walk the panel's history, as in any file manager. */
  protected onMouseUp(event: MouseEvent): void {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      this.command.emit({ command: event.button === 3 ? 'back' : 'forward', entryId: null });
    }
  }

  /**
   * Keys in the filter box: `Escape` empties it (and, once empty, leaves it),
   * `↓` and `Enter` go back to the listing it filters.
   */
  protected onFilterKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if ((this.browser().filterText ?? '') !== '') {
        this.filterChange.emit('');
      } else {
        this.focusListing();
      }
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      this.focusListing();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** The listing's tab stop — the cursor's row or tile — or the body itself when it lists nothing. */
  private focusListing(): void {
    const body = this.bodyElement().nativeElement;
    (body.querySelector<HTMLElement>('[tabindex="0"]') ?? body).focus();
  }

  /* -- drag and drop (PRD 005, §2) ------------------------------------------- */

  /**
   * A row or tile starts a drag: the whole selection when it is part of it,
   * else that entry alone — which it then selects, as file managers do.
   */
  protected onDragStart(event: DragEvent): void {
    const transfer = event.dataTransfer;
    const id = UiFileBrowser.entryIdAt(event.target);
    if (transfer === null || id === null || this.document()) {
      return;
    }
    const entries = this.entries();
    const isSelected = (entry: DragEntry | undefined): boolean => !!entry && (!!entry.selected || !!entry.inactiveSelected);
    const sources = isSelected(entries.find((entry) => entry.id === id))
      ? entries.filter(isSelected).map((entry) => entry.id)
      : [id];
    if (sources.length === 1 && sources[0] === id && !isSelected(entries.find((entry) => entry.id === id))) {
      this.selectionChange.emit({ selected: [id], focused: id });
    }

    this.dragging = new Set(sources);
    if (this.nativeDrag()) {
      // The system's drag, not the page's: it is the one other apps can take.
      event.preventDefault();
      this.nativeDragStart.emit(sources);
      return;
    }
    transfer.setData(UI_ENTRY_MIME, JSON.stringify({ sources }));
    transfer.effectAllowed = 'copyMove';
    if (sources.length > 1) {
      UiFileBrowser.countImage(transfer, sources.length);
    }
  }

  protected onDragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (transfer !== null && UiFileBrowser.carriesFiles(transfer) && this.browser().dropFolder) {
      // Files from outside: onto a folder under the pointer, or into the listed one.
      const target = this.dropTargetAt(event, true);
      event.preventDefault();
      transfer.dropEffect = this.nativeDrag() ? (UiFileBrowser.copies(event) ? 'copy' : 'move') : 'copy';
      this.dropTargetId.set(target ?? null);
      this.bodyDropTarget.set(target === null);
      return;
    }
    if (transfer === null || !Array.from(transfer.types).includes(UI_ENTRY_MIME)) {
      return;
    }
    const target = this.dropTargetAt(event);
    if (target === undefined) {
      transfer.dropEffect = 'none';
      this.clearDropTarget();
      return;
    }
    event.preventDefault();
    transfer.dropEffect = UiFileBrowser.copies(event) ? 'copy' : 'move';
    this.dropTargetId.set(target);
    this.bodyDropTarget.set(target === null);
  }

  protected onDragLeave(event: DragEvent): void {
    const body = event.currentTarget;
    const related = event.relatedTarget;
    if (body instanceof Node && related instanceof Node && body.contains(related)) {
      return;
    }
    this.clearDropTarget();
    if (this.nativeDrag()) {
      // A system drag ends with no `dragend` here; leaving is as good a sign as any.
      this.dragging = null;
    }
  }

  protected onDrop(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (transfer !== null && UiFileBrowser.carriesFiles(transfer) && this.browser().dropFolder) {
      const target = this.dropTargetAt(event, true) ?? null;
      this.clearDropTarget();
      this.dragging = null;
      event.preventDefault();
      event.stopPropagation();
      // The entries only exist while the drop event does: read them now.
      const entries = Array.from(transfer.items)
        .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
        .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);
      const files = Array.from(transfer.files);
      if (files.length > 0 || entries.length > 0) {
        this.filesDrop.emit({ files, entries, target, copy: UiFileBrowser.copies(event) });
      }
      return;
    }
    if (transfer === null || !Array.from(transfer.types).includes(UI_ENTRY_MIME)) {
      return;
    }
    const target = this.dropTargetAt(event);
    this.clearDropTarget();
    this.dragging = null;
    // Ours either way: the group around the browser has nothing to do with it.
    event.preventDefault();
    event.stopPropagation();
    const sources = UiFileBrowser.readSources(transfer);
    if (target === undefined || sources.length === 0) {
      return;
    }
    this.entryDrop.emit({ sources, target, copy: UiFileBrowser.copies(event) });
  }

  protected onDragEnd(): void {
    this.dragging = null;
    this.clearDropTarget();
  }

  /**
   * Where a drop at the pointer would go: a folder entry under it, `null` for
   * the listed folder, `undefined` for nowhere. A dragged entry is never its
   * own target; and within one browser the blank space is a target only for a
   * copy, since moving entries to the folder they are in does nothing.
   */
  private dropTargetAt(event: DragEvent, files = false): string | null | undefined {
    if (this.document()) {
      return undefined;
    }
    const id = UiFileBrowser.entryIdAt(event.target);
    const entry = id === null ? undefined : this.entries().find((candidate) => candidate.id === id);
    if (entry?.dropTarget && !this.dragging?.has(entry.id)) {
      return entry.id;
    }
    if (!this.browser().dropFolder) {
      return undefined;
    }
    // Files from outside may be anything, from anywhere: the listed folder takes them.
    return files || this.dragging === null || UiFileBrowser.copies(event) ? null : undefined;
  }

  /** A drag of files from outside the page — the system's file manager, or a native drag of ours. */
  private static carriesFiles(transfer: DataTransfer): boolean {
    const types = Array.from(transfer.types);
    return types.includes('Files') && !types.includes(UI_ENTRY_MIME);
  }

  private clearDropTarget(): void {
    this.dropTargetId.set(null);
    this.bodyDropTarget.set(false);
  }

  private entries(): readonly DragEntry[] {
    const browser = this.browser();
    return browser.view === 'grid' ? browser.items : browser.rows;
  }

  /** `Ctrl` (or `Alt`, macOS's Option) copies; a plain drag moves. */
  private static copies(event: DragEvent): boolean {
    return event.ctrlKey || event.altKey;
  }

  private static entryIdAt(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) {
      return null;
    }
    const element = target.closest('[data-row-id], [data-item-id]');
    return element?.getAttribute('data-row-id') ?? element?.getAttribute('data-item-id') ?? null;
  }

  /** The dragged paths, or none for a payload that is not one. */
  private static readSources(transfer: DataTransfer): readonly string[] {
    try {
      const parsed = JSON.parse(transfer.getData(UI_ENTRY_MIME)) as { sources?: unknown };
      return Array.isArray(parsed.sources) ? parsed.sources.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Several entries are dragged as a count, the way file managers show them,
   * rather than as a picture of whichever row the pointer happened to grab.
   */
  private static countImage(transfer: DataTransfer, count: number): void {
    const ghost = document.createElement('div');
    ghost.textContent = `${count} items`;
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      padding: '2px 8px',
      borderRadius: '10px',
      background: 'var(--vsc-badge-bg, #0078d4)',
      color: 'var(--vsc-accent-fg, #fff)',
      font: '12px sans-serif',
    });
    document.body.append(ghost);
    transfer.setDragImage(ghost, -12, -12);
    setTimeout(() => ghost.remove());
  }

  private static isTextField(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    );
  }

  /**
   * The entry the body is standing on, from whichever view is showing.
   *
   * `focused` is the cursor and `selected` the fallback, because a panel that
   * has only ever been clicked in has a selection but no keyboard cursor yet.
   */
  private focusedEntry(): string | null {
    const browser = this.browser();
    const entries: readonly { id: string; focused?: boolean; selected?: boolean }[] =
      browser.view === 'grid' ? browser.items : browser.rows;
    const entry = entries.find((candidate) => candidate.focused) ??
      entries.find((candidate) => candidate.selected);
    return entry?.id ?? null;
  }
}
