import { Component, computed, input, output, viewChild, type ElementRef } from '@angular/core';
import { UiBreadcrumbs } from '../breadcrumbs/ui-breadcrumbs';
import { UiSearchField } from '../controls/ui-search-field';
import { UiSegmented, type UiSegmentedOption } from '../controls/ui-segmented';
import { UiDocumentView } from '../document-view/ui-document-view';
import { UiEmptyState } from '../empty-state/ui-empty-state';
import { UiFileList } from '../file-list/ui-file-list';
import { UiIconView } from '../icon-view/ui-icon-view';
import { UiPanelBody } from '../panel-group/ui-panel-body';
import { UiPanelToolbar } from '../panel-toolbar/ui-panel-toolbar';
import type { UiFileBrowserModel, UiPanelKey, UiPanelView } from '../models';

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
 * listing as a whole rather than one row in it.
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
  readonly rowSelect = output<string>();
  readonly rowActivate = output<string>();

  /** A folder in the tree view was opened or closed in place. */
  readonly rowToggle = output<string>();
  readonly itemSelect = output<string>();
  readonly itemActivate = output<string>();

  /** A key pressed inside the browser whose meaning is the application's. */
  readonly command = output<UiPanelKey>();

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
