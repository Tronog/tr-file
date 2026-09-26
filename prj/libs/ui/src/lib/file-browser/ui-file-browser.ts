import { Component, computed, input, output, signal, viewChild, type ElementRef } from '@angular/core';
import { UiBreadcrumbs } from '../breadcrumbs/ui-breadcrumbs';
import { UiSearchField } from '../controls/ui-search-field';
import { UiSegmented, type UiSegmentedOption } from '../controls/ui-segmented';
import { UiDocumentView } from '../document-view/ui-document-view';
import { UiEmptyState } from '../empty-state/ui-empty-state';
import { UiFileList } from '../file-list/ui-file-list';
import { UiIconView } from '../icon-view/ui-icon-view';
import { UiPanelBody } from '../panel-group/ui-panel-body';
import { UiPanelToolbar } from '../panel-toolbar/ui-panel-toolbar';
import {
  UI_ENTRY_MIME,
  type UiEntryDrop,
  type UiFileBrowserModel,
  type UiPanelCommand,
  type UiPanelKey,
  type UiPanelView,
  type UiSelectionChange,
} from '../models';

/** An entry of whichever view is showing, as far as dragging needs it. */
interface DragEntry {
  readonly id: string;
  readonly selected?: boolean;
  readonly inactiveSelected?: boolean;
  readonly dropTarget?: boolean;
}

/** The clipboard chords, by key. */
const CLIPBOARD_KEYS: Readonly<Record<string, UiPanelCommand>> = { c: 'copy', x: 'cut', v: 'paste' };

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
 * a `UiEntryDrop`. The drag is one for the page's own drag and drop, typed
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
  host: { '(keydown)': 'onKeydown($event)' },
})
export class UiFileBrowser {
  readonly browser = input.required<UiFileBrowserModel>();

  readonly breadcrumbSelect = output<string>();
  readonly toolbarAction = output<string>();
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

  /** The folder a drag is over, lit in the list or grid. */
  protected readonly dropTargetId = signal<string | null>(null);

  /** A drag is over blank space, so the listed folder itself is the target. */
  protected readonly bodyDropTarget = signal(false);

  /** What is being dragged out of *this* browser, while it is. */
  private dragging: ReadonlySet<string> | null = null;

  private readonly bodyElement = viewChild.required<ElementRef<HTMLElement>>('body');

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
   * `Ctrl`+`Enter` opens what the cursor is on in a panel of its own
   * (PRD 001, §6.2.5). Bound on the host, so it answers with focus anywhere in
   * the browser — a row, a tile, the document, the path bar. The browser
   * knows which entry has focus from its own model, so one handler covers the
   * listing, the tree and the grid alike. Handled before the key reaches the group
   * around it, which claims the other `Ctrl` chords.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (this.onClipboardKey(event)) {
      return;
    }
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== 'Enter') {
      return;
    }

    const entryId = this.focusedEntry();
    if (entryId === null) {
      return;
    }

    this.command.emit({ command: 'open-aside', entryId });
    event.preventDefault();
  }

  /**
   * The keys that are about the listing as a whole, wherever focus sits in
   * the body.
   *
   * `Alt`+`←`/`→` walks the folders this panel has visited (PRD 001, §6.2.1)
   * and `Alt`+`↑` leaves the current one for its parent (§6.2.3) — the
   * *trail* and the *tree* are different journeys, which is why they are
   * different chords. They are handled here rather than in the list and the
   * grid because they are about the *folder*, not about what is selected in
   * it — and because they must work just as well when the body is a document,
   * or the empty-state placeholder, neither of which has a keyboard of its
   * own. Both views let an `Alt` chord bubble untouched so it arrives here
   * exactly once.
   *
   * `Backspace` and `F5` are handled here *only* when the body itself has
   * focus, which is the empty-folder case: without it, a keyboard user who
   * walked into an empty folder would have no way to walk back out of it.
   * Whenever there is a row or a tile to stand on, those keys belong to the
   * view that owns it. `Alt`+`↑` needs no such guard, since neither view
   * claims an `Alt` chord.
   */
  protected onBodyKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (event.altKey) {
      if (event.key === 'ArrowLeft') {
        this.command.emit({ command: 'back', entryId: null });
      } else if (event.key === 'ArrowRight') {
        this.command.emit({ command: 'forward', entryId: null });
      } else if (event.key === 'ArrowUp') {
        this.command.emit({ command: 'up', entryId: null });
      } else {
        return;
      }
      event.preventDefault();
      return;
    }

    // Only when the body itself has focus, which happens when it has nothing
    // to give focus to: an empty folder. The list and the grid own these keys
    // whenever there is a row or a tile to stand on, and handling them here as
    // well would run them twice.
    if (event.target !== this.bodyElement().nativeElement) {
      return;
    }

    if (event.key === 'Backspace') {
      this.command.emit({ command: 'up', entryId: null });
    } else if (event.key === 'F5') {
      this.command.emit({ command: 'refresh', entryId: null });
    } else {
      return;
    }

    event.preventDefault();
  }

  /**
   * `Ctrl`+`C` / `X` / `V` (`Cmd` on macOS) — copy, cut and paste entries
   * (PRD 005, §2). Only over a listing, and never in a text field or the
   * document viewer, where the chords keep their usual meaning for text.
   * Copy and cut need an entry to stand on; paste goes into the listed folder.
   */
  private onClipboardKey(event: KeyboardEvent): boolean {
    const chord = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const command = chord ? CLIPBOARD_KEYS[event.key.toLowerCase()] : undefined;
    if (command === undefined || this.document() || UiFileBrowser.isTextField(event.target)) {
      return false;
    }
    const entryId = this.focusedEntry();
    if (command !== 'paste' && entryId === null) {
      return false;
    }
    this.command.emit({ command, entryId });
    event.preventDefault();
    return true;
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

    transfer.setData(UI_ENTRY_MIME, JSON.stringify({ sources }));
    transfer.effectAllowed = 'copyMove';
    if (sources.length > 1) {
      UiFileBrowser.countImage(transfer, sources.length);
    }
    this.dragging = new Set(sources);
  }

  protected onDragOver(event: DragEvent): void {
    const transfer = event.dataTransfer;
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
  }

  protected onDrop(event: DragEvent): void {
    const transfer = event.dataTransfer;
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
  private dropTargetAt(event: DragEvent): string | null | undefined {
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
    return this.dragging === null || UiFileBrowser.copies(event) ? null : undefined;
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
