import { computed, effect, signal, untracked } from '@angular/core';
import type {
  UiBreadcrumb,
  UiEntryDrop,
  UiFilesDrop,
  UiFileBrowserModel,
  UiFileColumn,
  UiFileRow,
  UiIconAction,
  UiIconViewItem,
  UiPanelView,
  UiPathSuggestion,
  UiSelectionChange,
} from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { nameFilter } from '../listing/listing-order';
import { locationQuery, SUGGESTIONS_SHOWN, suggestPlaces } from '../listing/location-suggest';
import { deltaOf } from '../listing/array-delta';
import { namePattern, patternProblem } from '../listing/name-pattern';
import type { PanelContentFeature } from '../panel-content.model';
import {
  DEFAULT_SORT,
  PANEL_CONTENT,
  type PanelGroupState,
  type PanelSort,
  type PanelSortKey,
  type PanelTabState,
} from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';
import type { FileViewModelFeature } from './file-view-model.feature';
import type { EditorGroupsFeature } from './editor-groups.feature';
import type { FsListingProgressState, FsListingState } from './fs-data.feature';
import { isFolder } from '../../file-system/fs-entry-kind';
import { shownPath } from '../../file-system/fs-path';

/** Columns of the list view; the backend supplies every value, and each can sort it (PRD 003, §5). */
const COLUMNS: readonly (UiFileColumn & { readonly key: PanelSortKey })[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size', width: '90px', align: 'end' },
  { key: 'type', label: 'Type', width: '110px' },
  { key: 'modified', label: 'Modified', width: '150px' },
];

/** The columns, with the one the panel is sorted by marked — its header shows the arrow. */
function columnsFor(sort: PanelSort): readonly UiFileColumn[] {
  return COLUMNS.map((column) => (column.key === sort.key ? { ...column, sort: sort.direction } : column));
}

const SORT_KEYS: ReadonlySet<string> = new Set(COLUMNS.map((column) => column.key));

/** Toolbar of a file tab: back to its folder, re-read, save it. */
const FILE_TOOLBAR: readonly UiIconAction[] = [
  { id: 'up', label: 'Show the containing folder', icon: 'arrow-up' },
  { id: 'refresh', label: 'Reload this file', icon: 'refresh' },
  { id: 'download', label: 'Download this file', icon: 'download' },
];

const EMPTY_FOLDER = {
  icon: 'folder-open',
  title: 'This folder is empty',
  hint: 'Drop files here to upload them',
} as const;

/** A listing's rows as they are made once per array; `index` (path → place) only once something needed it. */
interface BaseRows {
  readonly rows: readonly UiFileRow[];
  index?: Map<string, number>;
}

interface BaseItems {
  readonly items: readonly UiIconViewItem[];
  index?: Map<string, number>;
}

/** A row's cells, each label made the first time it is read, and kept. */
class RowCells {
  private sizeText: string | undefined;
  private typeText: string | undefined;
  private modifiedText: string | undefined;

  constructor(
    private readonly entry: FsEntry,
    private readonly files: FileViewModelFeature,
  ) {}

  get size(): string {
    return (this.sizeText ??= this.files.sizeLabel(this.entry));
  }

  get type(): string {
    return (this.typeText ??= this.files.typeLabel(this.entry));
  }

  get modified(): string {
    return (this.modifiedText ??= this.files.modifiedLabel(this.entry));
  }
}

/** What the filter box says while it is empty. */
const FILTER_PLACEHOLDER = 'Filter (Ctrl+F)';

/** The tree view of a panel that has opened nothing yet. */
const NONE_OPEN: ReadonlySet<string> = new Set();

/** Parent of a root-relative path; the root's children answer `''`. */
function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * File management as panel content: what a folder tab lists and a file tab
 * shows, and everything done from inside them — opening entries, walking up
 * and across folders, the toolbar, the path bar, uploads.
 *
 * The groups and their tabs belong to `EditorGroupsFeature`; this feature
 * changes them only through its operations, and renders one
 * `UiFileBrowserModel` per group whose active tab is file-management content.
 * The directory contents come from the shared `FsDataFeature` cache and the
 * files from `FilePreviewFeature`. Like every model here it only ever *reads*
 * those while rendering — fetches are started by the actions below, never by
 * a computed.
 *
 * The tree view (PRD 002, §4.1) is the details table with folders that open in
 * place. Which ones are open is this feature's own state, kept *per panel*:
 * two panels on the same folder are two places someone is working, as with
 * their history. Opening a folder is an action, so that is where its listing
 * is fetched; the rows only read what the cache already holds.
 */
export class FileBrowserFeature implements PanelContentFeature {
  /** Folders open in each panel's tree view, keyed by group id. */
  private readonly expanded = signal<Readonly<Record<string, ReadonlySet<string>>>>({});

  /**
   * What each panel's filter box holds, keyed by group id (PRD 003, §5). A
   * filter is about the folder it was typed in, so leaving the folder clears it.
   */
  private readonly filters = signal<Readonly<Record<string, string>>>({});

  /** Requests for each panel's filter box and path bar to take the keyboard, by group id. */
  private readonly focusRequests = signal<Readonly<Record<string, { readonly filter: number; readonly location: number }>>>({});

  constructor(private readonly parent: WorkbenchService) {
    // A large folder left before it is all read — its tab gone to another folder, or closed —
    // stops being read (PRD 004, §3.1.2), unless it is still on screen somewhere else.
    effect(() => {
      const shown = new Set([...this.ordersWanted().map(({ path }) => path), ...this.parent.explorerFt.foldersShown()]);
      untracked(() => {
        for (const path of this.shownBefore) {
          if (!shown.has(path)) {
            this.parent.fsDataFt.abortLarge(path);
          }
        }
        for (const path of shown) {
          if (!this.shownBefore.has(path)) {
            this.parent.fsDataFt.keepLarge(path);
          }
        }
        this.shownBefore = shown;
      });
    });
  }

  /** The folders on screen when last looked — to tell which of them left it. */
  private shownBefore: ReadonlySet<string> = new Set();

  private get groups(): EditorGroupsFeature {
    return this.parent.editorGroupsFt;
  }

  /**
   * View models keyed by group id, for every group whose active tab is file
   * management — so the workbench template is a lookup.
   */
  readonly browsersById = computed<Readonly<Record<string, UiFileBrowserModel>>>(() => {
    const activeGroupId = this.parent.activeGroupId();
    const entries = this.groups.states().flatMap((group) => {
      const tab = this.groups.activeTabOf(group);
      return tab && PANEL_CONTENT[tab.kind] === 'files'
        ? [[group.id, this.toViewModel(group, tab, group.id === activeGroupId)] as const]
        : [];
    });
    return Object.fromEntries(entries);
  });

  /** Lookup used by the workbench template. */
  browser(groupId: string): UiFileBrowserModel | undefined {
    return this.browsersById()[groupId];
  }

  /* -- panel content ----------------------------------------------------- */

  /** Lists a folder tab's directory, or reads a file tab's file. */
  load(tab: PanelTabState): void {
    if (tab.kind === 'file') {
      this.parent.filePreviewFt.load(tab.path);
      return;
    }
    this.parent.fsDataFt.ensureListing(tab.path);
  }

  isLoading(group: PanelGroupState, tab: PanelTabState): boolean {
    return tab.kind === 'file'
      ? this.parent.filePreviewFt.isLoading(tab.path)
      : this.parent.fsDataFt.listingState(group.path)?.status === 'loading';
  }

  /** Files dropped on a panel land in its directory. */
  acceptsFiles(): boolean {
    return true;
  }

  /* -- navigation -------------------------------------------------------- */

  /**
   * How a panel shows its folder: what was chosen for that folder
   * (PRD 004, §1.3.1), else what the panel last showed.
   */
  viewOf(groupId: string): UiPanelView {
    const group = this.groups.stateOf(groupId);
    return group === undefined ? 'list' : this.viewFor(group);
  }

  /** Shows a panel's folder as `view` — and every panel showing that folder, from now on. */
  setView(id: string, view: UiPanelView): void {
    this.groups.update(id, (group) => ({ ...group, view }));
    this.rememberFor(id, (path) => this.parent.folderViewsFt.rememberView(path, view));
  }

  /* -- order and filter (PRD 003, §5) --------------------------------------- */

  /**
   * How a panel orders its listing: the order chosen for its folder
   * (PRD 004, §1.3.1), else the panel's last.
   */
  sortOf(groupId: string): PanelSort {
    return this.sortIn(groupId, this.groups.stateOf(groupId)?.path);
  }

  /**
   * How a panel would order `folder` — the order chosen for it, else the
   * panel's last — for a panel showing one of its files (PRD 012, §1.1).
   */
  sortIn(groupId: string, folder: string | undefined): PanelSort {
    const group = this.groups.stateOf(groupId);
    return (folder === undefined ? undefined : this.parent.folderViewsFt.sortOf(folder)) ?? group?.sort ?? DEFAULT_SORT;
  }

  /**
   * A column header was clicked: sort by it, A to Z — or, when the panel is
   * already sorted by it, the other way round.
   */
  toggleSort(groupId: string, key: string): void {
    if (!SORT_KEYS.has(key)) {
      return;
    }
    const current = this.sortOf(groupId);
    const direction = current.key === key && current.direction === 'asc' ? 'desc' : 'asc';
    this.setSort(groupId, { key: key as PanelSortKey, direction });
  }

  setSort(groupId: string, sort: PanelSort): void {
    this.groups.update(groupId, (group) => ({ ...group, sort }));
    this.rememberFor(groupId, (path) => this.parent.folderViewsFt.rememberSort(path, sort));
  }

  /** Remembers a choice for the folder a panel lists — not for a file it shows. */
  private rememberFor(groupId: string, remember: (path: string) => void): void {
    const group = this.groups.stateOf(groupId);
    if (group !== undefined && this.groups.activeTabOf(group)?.kind === 'folder') {
      remember(group.path);
    }
  }

  private viewFor(group: PanelGroupState): UiPanelView {
    return this.parent.folderViewsFt.viewOf(group.path) ?? group.view;
  }

  /** What the panel's filter box holds; `''` when nothing is filtered out. */
  filterOf(groupId: string): string {
    return this.filters()[groupId] ?? '';
  }

  setFilter(groupId: string, text: string): void {
    if (this.filterOf(groupId) === text) {
      return;
    }
    this.filters.update((all) => ({ ...all, [groupId]: text }));
  }

  /**
   * The entries of `path` as the panel shows them: filtered by its box, in its
   * order, hidden ones left out unless the workbench shows them. Every view —
   * list, grid, tree — and every command about "what is on screen" reads this.
   */
  visibleEntries(groupId: string, path: string): readonly FsEntry[] {
    const sorted = this.ordered(path, this.sortOf(groupId));
    const filter = this.filterOf(groupId);
    if (filter.trim() === '') {
      return sorted;
    }
    const matches = nameFilter(filter);
    return sorted.filter((entry) => matches(entry.name));
  }

  /**
   * A folder's entries in `sort`'s order — for a large one, as the Web Worker
   * last worked it out (`ListingOrderFeature`, PRD 004, §3.1). Sorted before
   * the filter is applied, so typing in the box never asks for a new order.
   */
  ordered(path: string, sort: PanelSort): readonly FsEntry[] {
    return this.parent.listingOrderFt.sorted(path, this.parent.fsDataFt.entries(path), sort, (entry) =>
      this.parent.fileViewModel.typeLabel(entry),
    );
  }

  /**
   * Every folder on screen and the order it is shown in — a panel's own, one
   * open in its tree, and the folder of an image a panel shows, which
   * `PgUp`/`PgDown` step through: what `ListingOrderFeature` keeps ordered.
   */
  ordersWanted(): readonly { readonly path: string; readonly sort: PanelSort }[] {
    const wanted: { path: string; sort: PanelSort }[] = [];
    for (const group of this.groups.states()) {
      const tab = this.groups.activeTabOf(group);
      if (tab?.kind === 'file') {
        const folder = parentOf(tab.path);
        wanted.push({ path: folder, sort: this.sortIn(group.id, folder) });
        continue;
      }
      if (tab?.kind !== 'folder') {
        continue;
      }
      const sort = this.sortOf(group.id);
      wanted.push({ path: group.path, sort });
      if (this.viewFor(group) === 'tree') {
        for (const path of this.openFoldersShown(group)) {
          wanted.push({ path, sort });
        }
      }
    }
    return wanted;
  }

  /** The entries a panel is showing, in order — its folder's, and in the tree view those of open folders. */
  entriesShown(groupId: string): readonly string[] {
    const browser = this.browser(groupId);
    if (browser === undefined) {
      return [];
    }
    return browser.view === 'grid' ? browser.items.map((item) => item.id) : browser.rows.map((row) => row.id);
  }

  /**
   * Every folder whose listing is on screen in some panel: each panel's own,
   * and in the tree view the folders open under it — what auto-refresh
   * watches (PRD 003, §5).
   */
  foldersShown(): readonly string[] {
    const folders = new Set<string>();
    for (const group of this.groups.states()) {
      if (this.groups.activeTabOf(group)?.kind !== 'folder') {
        continue;
      }
      folders.add(group.path);
      if (this.viewFor(group) === 'tree') {
        for (const path of this.openFoldersShown(group)) {
          folders.add(path);
        }
      }
    }
    return [...folders];
  }

  /** Puts the keyboard in a panel's filter box — *Edit › Filter Folder*. */
  focusFilter(groupId: string): void {
    this.request(groupId, 'filter');
  }

  /** Turns a panel's path bar into a text field — *Go › Go to Location…*. */
  editLocation(groupId: string): void {
    this.request(groupId, 'location');
  }

  private request(groupId: string, what: 'filter' | 'location'): void {
    this.groups.focus(groupId);
    this.focusRequests.update((all) => {
      const current = all[groupId] ?? { filter: 0, location: 0 };
      return { ...all, [groupId]: { ...current, [what]: current[what] + 1 } };
    });
  }

  /* -- selection (PRD 003, §5: the Selection menu) --------------------------- */

  /** Selects everything the panel shows. */
  selectAll(groupId: string): void {
    const shown = this.entriesShown(groupId);
    const group = this.groups.stateOf(groupId);
    if (group === undefined || shown.length === 0) {
      return;
    }
    const focused = group.focusedEntryId !== undefined && shown.includes(group.focusedEntryId) ? group.focusedEntryId : shown[0];
    this.setSelection(groupId, { selected: shown, focused: focused ?? null });
  }

  selectNone(groupId: string): void {
    this.groups.update(groupId, (group) => ({ ...group, selection: [] }));
  }

  /** Selects what was not selected, and leaves what was. */
  invertSelection(groupId: string): void {
    const group = this.groups.stateOf(groupId);
    if (group === undefined) {
      return;
    }
    const selected = new Set(group.selection);
    const inverted = this.entriesShown(groupId).filter((path) => !selected.has(path));
    this.groups.update(groupId, (state) => ({
      ...state,
      selection: inverted,
      ...(inverted[0] === undefined ? {} : { focusedEntryId: inverted[0] }),
    }));
    if (inverted[0] !== undefined) {
      this.parent.select(inverted[0]);
    }
  }

  /**
   * `+` / `-` (PRD 004, §2): asks for a pattern — `*.txt`, see `namePattern`
   * — and adds the entries the panel shows whose names match it to the
   * selection, or takes them out of it. The cursor stays where it is.
   *
   * An entry selected only because the cursor stands on it was never picked,
   * so selecting by a pattern starts without it, as `Insert` does.
   */
  async selectByPattern(groupId: string, select: boolean): Promise<void> {
    if (this.groups.stateOf(groupId) === undefined || this.entriesShown(groupId).length === 0) {
      return;
    }
    const value = this.lastPattern;
    const answer = await this.parent.modal.prompt({
      message: select ? 'Select the entries whose names match:' : 'Unselect the entries whose names match:',
      detail: '* stands for any characters, ? for one; separate several patterns with ;',
      label: 'Pattern',
      value,
      selection: [0, value.length],
      confirmLabel: select ? 'Select' : 'Unselect',
      validate: patternProblem,
    });
    const group = this.groups.stateOf(groupId);
    if (answer === null || group === undefined) {
      return;
    }
    this.lastPattern = answer.trim();

    const matches = namePattern(answer);
    const lone = group.selection.length === 1 && group.selection[0] === group.focusedEntryId;
    const selected = new Set(select && lone ? [] : group.selection);
    const shown = this.entriesShown(groupId);
    for (const path of shown) {
      if (matches(path.slice(path.lastIndexOf('/') + 1))) {
        if (select) {
          selected.add(path);
        } else {
          selected.delete(path);
        }
      }
    }
    this.groups.update(groupId, (state) => ({ ...state, selection: shown.filter((path) => selected.has(path)) }));
  }

  /** The pattern `+` / `-` last used, offered again. */
  private lastPattern = '*';

  /**
   * Opens an entry by its path — a context menu's, the explorer's — as a
   * double click on it would: whether or not the panel is showing it.
   */
  openPath(groupId: string, path: string): void {
    if (this.entryIn(groupId, path) !== undefined) {
      this.openEntry(groupId, path);
      return;
    }
    const entry = this.parent.fsDataFt.entryAt(path);
    if (entry !== undefined && isFolder(entry)) {
      this.openFolder(groupId, path, entry.name);
      this.parent.panelFocusFt.focusBody(groupId);
    } else if (entry !== undefined && this.parent.archiveBrowserFt.browses(path)) {
      this.parent.archiveBrowserFt.open(groupId, path);
    } else if (entry !== undefined && !this.parent.filePreviewFt.canPreview(path)) {
      void this.parent.systemOpenFt.open(path);
    } else if (entry !== undefined) {
      this.parent.filePreviewFt.open(path);
    }
  }

  /** Opens an entry by its path in a new panel beside `groupId`. */
  openPathAside(groupId: string, path: string): void {
    this.openEntryAside(groupId, path);
  }

  /**
   * The path bar is typed in (PRD 004, §4.2): what it holds is kept, for its
   * suggestions, and the folder being typed in is read — an action, so a
   * fetch may start here; a folder already read is not read again.
   */
  locationInput(groupId: string, text: string): void {
    this.locationTyped.update((all) => ({ ...all, [groupId]: text }));
    const query = locationQuery(text);
    if (query !== null) {
      this.parent.fsDataFt.ensureListing(query.folder);
    }
  }

  /** What each panel's path bar holds while it is typed in. */
  private readonly locationTyped = signal<Readonly<Record<string, string>>>({});

  /**
   * The places a panel's path bar suggests for what is typed in it (PRD 004,
   * §4.2): entries of the folder typed so far whose names fit the rest, case
   * ignored — kept per panel while neither the text nor the folder changes,
   * as a panel is drawn far more often than typed in.
   */
  locationSuggestionsFor(groupId: string): readonly UiPathSuggestion[] {
    const text = this.locationTyped()[groupId];
    const query = text === undefined ? null : locationQuery(text);
    if (query === null) {
      return [];
    }
    const entries = this.parent.fsDataFt.entries(query.folder);
    const kept = this.suggested.get(groupId);
    if (kept !== undefined && kept.text === text && kept.entries === entries) {
      return kept.suggestions;
    }
    const files = this.parent.fileViewModel;
    const found = suggestPlaces(entries, query.fragment).map(
      (entry): UiPathSuggestion => ({ value: shownPath(entry.path), label: entry.name, icon: files.icon(entry), ...(isFolder(entry) ? { folder: true } : {}) }),
    );
    // A folder typed with a `/` after it is itself the first suggestion: the first is chosen, and
    // `Enter` must go to the folder typed, not to whatever sorts first inside it (PRD 004, §4.2).
    const listing = this.parent.fsDataFt.listingState(query.folder)?.listing;
    const folder = listing?.path ?? query.folder;
    const itself: UiPathSuggestion = {
      value: shownPath(folder),
      label: folder === '' ? this.parent.workspaceName() : (folder.split('/').at(-1) ?? folder),
      icon: 'folder-open',
      folder: true,
    };
    const suggestions = query.fragment === '' && listing !== undefined ? [itself, ...found.slice(0, SUGGESTIONS_SHOWN - 1)] : found;
    this.suggested.set(groupId, { text: text as string, entries, suggestions });
    return suggestions;
  }

  private readonly suggested = new Map<string, { readonly text: string; readonly entries: readonly FsEntry[]; readonly suggestions: readonly UiPathSuggestion[] }>();

  /**
   * A path typed into a panel's path bar (PRD 003, §5), absolute within the
   * workspace: a folder is shown in the panel, a file in the folder it is in —
   * selected, so it is where the keyboard lands. What is not there is said so.
   */
  async goToLocation(groupId: string, text: string): Promise<void> {
    const location = await this.resolveLocation(groupId, text);
    if (location === null) {
      return;
    }
    this.openFolder(groupId, location.folder, this.labelFor(location.folder));
    if (location.file !== undefined) {
      this.selectEntry(groupId, location.file);
    }
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /**
   * What a path typed in a path bar names — the folder, or the file and the
   * folder it is in — as the disk spells it, or `null` once it has said why
   * there is nothing there. `key` is the path bar's, whose suggestions end
   * with the edit; Disk Usage's path bars come here too (PRD 013, §2.1).
   */
  async resolveLocation(key: string, text: string): Promise<{ readonly folder: string; readonly file?: string } | null> {
    // The edit is over: nothing more to suggest until the next.
    this.locationTyped.update(({ [key]: _done, ...rest }) => rest);
    const segments = text.trim().replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.');
    const shown = shownPath(segments.join('/'));
    if (segments.includes('..')) {
      await this.parent.modal.message({
        severity: 'error',
        message: `'${text.trim()}' is not a path this panel can go to.`,
        detail: "Leave out '..': type the folder's own path from / up, e.g. /docs/prd.",
      });
      return null;
    }
    try {
      const details = await this.parent.fileSystem.readFt.details(segments.join('/'));
      // The path as the disk spells it — `s:\tronog` typed is `S:/Tronog` — or nothing opened from
      // it would match the paths its listing reports (PRD 004, §4.1).
      const path = details.path;
      return isFolder(details) ? { folder: path } : { folder: parentOf(path), file: path };
    } catch (error) {
      const failure = FsError.from(error);
      await this.parent.modal.message({
        severity: 'error',
        message: failure.code === 'NOT_FOUND' ? `There is no file or folder at '${shown}'.` : `Could not open '${shown}'.`,
        detail: failure.code === 'NOT_FOUND' ? 'Check the path, and try again.' : failure.message,
      });
      return null;
    }
  }

  /**
   * Opens a folder in place in the tree view, or closes it again — fetching
   * its listing the first time. Anything that is not a folder on screen in
   * this panel is ignored.
   */
  toggleEntry(groupId: string, entryId: string): void {
    const entry = this.entryIn(groupId, entryId);
    if (entry === undefined || !isFolder(entry)) {
      return;
    }

    const open = this.expandedIn(groupId);
    const next = new Set(open);
    if (open.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      this.parent.fsDataFt.ensureListing(entry.path);
    }

    this.expanded.update((all) => ({ ...all, [groupId]: next }));
    this.groups.focus(groupId);
  }

  /**
   * Takes a selection from the list, tree or grid (PRD 004, §1.2): one entry
   * or many, and the one the cursor is on. The details sidebar follows the
   * cursor while something is selected; a cursor standing on an entry with
   * nothing selected — where focus handed to a listing lands — describes the
   * folder instead (PRD 004, §1.3.3). A box that caught nothing leaves the
   * cursor, and the sidebar, where they were.
   */
  setSelection(groupId: string, change: UiSelectionChange): void {
    this.groups.update(groupId, (group) => ({
      ...group,
      selection: [...change.selected],
      ...(change.focused === null ? {} : { focusedEntryId: change.focused }),
    }));
    this.groups.focus(groupId);
    if (change.focused === null) {
      return;
    }
    const folder = this.groups.stateOf(groupId)?.path;
    this.parent.select(change.selected.length === 0 && folder !== undefined ? folder : change.focused);
  }

  /** Selects an entry inside a group, and only it; the details sidebar follows. */
  selectEntry(groupId: string, entryId: string): void {
    this.groups.update(groupId, (group) => ({ ...group, selection: [entryId], focusedEntryId: entryId }));
    this.groups.focus(groupId);
    this.parent.select(entryId);
  }

  /**
   * Opens an entry: a directory re-points the group at it, a file opens in a
   * read-only tab. Saving a file to disk is the Download action, not a
   * double-click — a viewer exists now, so opening should show it.
   */
  openEntry(groupId: string, entryId: string): void {
    const entry = this.entryIn(groupId, entryId);
    if (!entry) {
      return;
    }
    // A link to a folder is navigated into like one (PRD 003, §1).
    if (isFolder(entry)) {
      this.navigateTo(groupId, entry.path, entry.name);
    } else if (this.parent.archiveBrowserFt.browses(entry.path)) {
      // A zip is looked into, in a tab of its own (PRD 003, §6).
      this.parent.archiveBrowserFt.open(groupId, entry.path);
      return;
    } else if (!this.parent.filePreviewFt.canPreview(entry.path)) {
      // Nothing in the app can show it — a PDF, a document, an archive — so
      // it goes to an application that can (PRD 003, §5); the listing stays.
      this.groups.focus(groupId);
      void this.parent.systemOpenFt.open(entry.path);
      return;
    } else {
      this.groups.focus(groupId);
      this.parent.filePreviewFt.open(entry.path);
    }

    // Either way the listing that had focus is gone — replaced by another
    // listing, or by the file's viewer — so without this the keyboard falls
    // out of the panel entirely and its own chords reach nothing: no
    // `Alt`+`←`, and no `Ctrl`+`W` to close the tab that was just opened.
    // Whether the entry was opened by double click or by `Enter`.
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /**
   * `Backspace` inside a panel body: the same journey as the toolbar's Up
   * button, which is the one traditional file managers bind it to.
   */
  navigateUp(groupId: string): void {
    this.runToolbarAction(groupId, 'up');
  }

  /**
   * `Ctrl`+`Enter` and `Ctrl`+double click (PRD 002, §2.5): opens an entry in
   * a new tab of the *other* panel — the one active before this, as
   * `EditorGroupsFeature.otherGroupOf` finds it — the way a two-panel file
   * manager shows something on the other side. A folder gets its listing, a
   * file its viewer (a tab already showing that file is chosen instead). With
   * no other panel, a new one is split off to the right for it. The keyboard
   * goes with it, because opening something there is a request to look at it
   * — and `Ctrl`+`W` then closes it.
   */
  openEntryAside(groupId: string, entryId: string): void {
    const entry = this.entryIn(groupId, entryId) ?? this.parent.fsDataFt.entryAt(entryId);
    if (!entry) {
      return;
    }

    const directory = isFolder(entry);
    const tab = { label: entry.name, path: entry.path, kind: directory ? ('folder' as const) : ('file' as const) };
    const source = this.groups.stateOf(groupId);
    const from = source === undefined ? undefined : this.groups.activeTabOf(source)?.id;
    let target = this.groups.otherGroupOf(groupId);
    if (target === undefined) {
      target = this.groups.openBeside(groupId, 'right', (id) => ({ id: `tab-${id}`, ...tab }));
      if (target === undefined) {
        return;
      }
      if (directory) {
        this.parent.fsDataFt.ensureListing(entry.path);
      } else {
        this.parent.filePreviewFt.load(entry.path);
      }
    } else if (directory) {
      this.groups.openTab(target, tab);
    } else {
      this.openFile(target, entry.path, entry.name);
      this.parent.filePreviewFt.load(entry.path);
    }
    if (!directory) {
      this.parent.select(entry.path);
    }
    // Closed, it gives the keyboard back to the tab it was opened from (PRD 002, §2.5.1).
    if (from !== undefined) {
      this.groups.markOpenedFrom(target, from);
    }

    this.parent.panelFocusFt.focusBody(target);
  }

  /* -- toolbar ----------------------------------------------------------- */

  runToolbarAction(groupId: string, actionId: string): void {
    const group = this.groups.stateOf(groupId);
    const active = group ? this.groups.activeTabOf(group) : undefined;
    if (!group || !active) {
      return;
    }

    switch (actionId) {
      case 'back':
        this.parent.panelHistoryFt.back(groupId);
        break;
      case 'forward':
        this.parent.panelHistoryFt.forward(groupId);
        break;
      case 'new-file':
        void this.parent.fileEditFt.createFile(group.path, groupId);
        break;
      case 'new-folder':
        void this.parent.fileEditFt.createFolder(group.path, groupId);
        break;
      case 'open-external':
        void this.parent.systemOpenFt.open(active.path);
        break;
      case 'up': {
        // From a file, "up" shows the folder that contains it.
        const from = active.kind === 'file' ? active.path : group.path;
        if (from === '') {
          return;
        }
        const parentPath = parentOf(from);
        this.openFolder(groupId, parentPath, this.labelFor(parentPath));
        break;
      }
      case 'refresh':
        if (active.kind === 'file') {
          this.parent.filePreviewFt.reload(active.path);
        } else {
          // Everything on screen is re-read: in the tree, that includes the
          // folders open under this one.
          void this.parent.fsDataFt.reloadListing(group.path);
          for (const path of this.openFoldersShown(group)) {
            void this.parent.fsDataFt.reloadListing(path);
          }
          // The entry described beside it, if it is in this folder — or is this folder: a manual
          // refresh is what counts a large folder's entries again, if they were counted (PRD 004, §3.1.3).
          const selected = this.parent.selectedEntryId();
          if (selected !== '' && (selected === group.path || parentOf(selected) === group.path)) {
            void this.parent.fsDataFt.reloadDetails(selected, this.parent.detailsFt.recounts(selected));
          }
        }
        break;
      case 'upload':
        this.parent.requestUpload(groupId);
        break;
      case 'download':
        this.parent.transfersFt.download(active.path, active.label);
        break;
      case 'upload-folder':
        this.parent.requestUpload(groupId, undefined, true);
        break;
      default:
        break;
    }
  }

  /**
   * Clicking a path segment walks the group back up to it. The last crumb of a
   * file preview is the file itself, which is already on screen.
   */
  openBreadcrumb(groupId: string, crumbId: string): void {
    const group = this.groups.stateOf(groupId);
    const active = group ? this.groups.activeTabOf(group) : undefined;
    if (active?.kind === 'file' && crumbId === active.path) {
      return;
    }
    if (crumbId === 'root') {
      this.openFolder(groupId, '', this.labelFor(''));
      return;
    }
    this.openFolder(groupId, crumbId, this.labelFor(crumbId));
  }

  /**
   * Opens a file as its own read-only tab, or re-activates the tab that
   * already holds it. The group's own `path` follows the active tab, so a
   * group showing a file lists nothing until a folder tab takes over again.
   */
  openFile(groupId: string, path: string, label: string): void {
    const group = this.groups.stateOf(groupId);
    if (!group) {
      return;
    }

    const existing = group.tabs.find((tab) => tab.kind === 'file' && tab.path === path);
    const tabs = existing
      ? group.tabs
      : [...group.tabs, { id: `tab-file-${this.groups.createId()}`, label, path, kind: 'file' as const }];
    const activeId = existing?.id ?? tabs[tabs.length - 1]?.id;

    this.groups.setTabs(groupId, tabs, activeId);
    this.groups.focus(groupId);
  }

  /**
   * Shows a folder in a group, giving it a tab when it has none.
   *
   * A group whose active tab is a *file* gets a new folder tab instead of
   * having the preview rewritten underneath it: opening a folder in the
   * sidebar should never throw away the file someone is reading.
   */
  openFolder(groupId: string, path: string, label: string): void {
    const group = this.groups.stateOf(groupId);
    if (!group) {
      return;
    }

    const active = this.groups.activeTabOf(group);
    if (active && active.kind === 'folder') {
      this.navigateTo(groupId, path, label);
      return;
    }
    // The active tab is a file: there is no folder selection to keep on the trail.

    // A folder tab for this very path is reused rather than duplicated; only
    // then is a new one opened beside the preview.
    const existing = group.tabs.find((tab) => tab.kind === 'folder' && tab.path === path);
    const tab: PanelTabState = existing ?? {
      id: `tab-${this.groups.createId()}`,
      label,
      path,
      kind: 'folder',
    };
    const tabs = existing ? group.tabs : [...group.tabs, tab];

    this.setFilter(groupId, '');
    this.groups.setTabs(groupId, tabs, tab.id);
    this.parent.panelHistoryFt.record(groupId, path);
    this.parent.placesFt.recordRecent(path);
    this.parent.fsDataFt.ensureListing(path);
    this.parent.explorerFt.reveal(path);
    this.groups.focus(groupId);
  }

  /** Points a group and its active tab at another folder. */
  navigateTo(groupId: string, path: string, label: string): void {
    // A folder shown is shown in the file manager (PRD 001, §1.1): a bookmark's key, Jump to Folder…
    this.parent.subAppsFt.show('file-manager');
    if (this.groups.stateOf(groupId)?.path !== path) {
      this.setFilter(groupId, '');
      // What is selected here, kept on the trail for Back / Forward to put back (PRD 002, §2.1).
      this.parent.panelHistoryFt.leave(groupId);
    }
    this.groups.update(groupId, (group) => {
      const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
      // Navigating turns the active tab into a folder tab, which is what
      // "up one level" from a file preview means.
      const tabs = active
        ? group.tabs.map((tab) =>
            tab.id === active.id ? { ...tab, label, path, kind: 'folder' as const } : tab,
          )
        : group.tabs;
      return { ...group, tabs, path, selection: [] };
    });
    // Every folder a panel lands on goes on its trail; a move the trail itself
    // caused lands where the cursor already points, so it records nothing.
    this.parent.panelHistoryFt.record(groupId, path);
    this.parent.placesFt.recordRecent(path);
    this.parent.fsDataFt.ensureListing(path);
    // Opening a folder — or stepping back or forward to one — is what the
    // sidebar follows; a selection in the panel is not (PRD 001, §9.1.2).
    this.parent.explorerFt.reveal(path);
    this.groups.focus(groupId);
  }

  /** Files dropped from the desktop onto a panel land in its directory. */
  /**
   * Entries dropped on this panel (PRD 005, §2) — from it or from another:
   * into the folder they were dropped on, or the one the panel lists. A move
   * unless `Ctrl` was held; either way a job of `OperationsFeature`.
   */
  dropEntries(groupId: string, drop: UiEntryDrop): void {
    const destination = drop.target ?? this.groups.stateOf(groupId)?.path;
    if (destination === undefined) {
      return;
    }
    this.groups.focus(groupId);
    void this.parent.operationsFt.transfer(drop.copy ? 'copy' : 'move', drop.sources, destination);
  }

  uploadInto(groupId: string, files: readonly File[]): void {
    const group = this.groups.stateOf(groupId);
    if (!group || files.length === 0) {
      return;
    }
    this.groups.focus(groupId);
    this.parent.transfersFt.uploadFiles(group.path, files);
  }

  /**
   * Files from outside the page dropped on a panel (PRD 003, §6): onto a
   * folder in it, or into the folder it lists.
   *
   * On the desktop, files that are already in this window's root — dragged
   * from the system's file manager, or out of a panel as files and back —
   * are *entries*, and a drop of them is a move (a copy with `Ctrl`), as a
   * drop between panels is. Everything else is uploaded, folders and all.
   */
  async dropFiles(groupId: string, drop: UiFilesDrop): Promise<void> {
    const group = this.groups.stateOf(groupId);
    const destination = drop.target ?? group?.path;
    if (group === undefined || destination === undefined || (drop.files.length === 0 && drop.entries.length === 0)) {
      return;
    }
    this.groups.focus(groupId);
    const system = this.parent.fileSystem.systemFt;
    if (system.sharesFiles(this.parent.connection.connected()) && drop.files.length > 0) {
      const paths = await system.localPaths(drop.files);
      if (paths.every((path): path is string => path !== null)) {
        void this.parent.operationsFt.transfer(drop.copy ? 'copy' : 'move', paths, destination);
        return;
      }
    }
    this.parent.transfersFt.uploadDropped(destination, drop.files, drop.entries);
  }

  /**
   * Whether a drag out of a panel is the system's — files other apps take —
   * rather than the page's own (PRD 003, §6): on the desktop, for its own
   * computer's files.
   */
  readonly nativeDrag = computed(() => this.parent.fileSystem.systemFt.sharesFiles(this.parent.connection.connected()));

  /** A drag of these entries began, to be handed to the system (`nativeDrag`). */
  startNativeDrag(paths: readonly string[]): void {
    this.parent.fileSystem.systemFt.startDrag(paths);
  }

  /** The icon view has these tiles on screen: their thumbnails are worth making now (PRD 003, §6). */
  showItems(paths: readonly string[]): void {
    this.parent.thumbnailsFt.request(paths);
  }

  /**
   * An entry the panel is showing: one of its folder's own, or — in the tree
   * view — one inside a folder that is open under it.
   */
  private entryIn(groupId: string, entryId: string): FsEntry | undefined {
    const group = this.groups.stateOf(groupId);
    if (!group) {
      return undefined;
    }

    const own = this.parent.fsDataFt.shownEntryAt(group.path, entryId);
    if (own || !this.isShownInTree(group, entryId)) {
      return own;
    }
    return this.parent.fsDataFt.shownEntryAt(parentOf(entryId), entryId);
  }

  private expandedIn(groupId: string): ReadonlySet<string> {
    return this.expanded()[groupId] ?? NONE_OPEN;
  }

  /**
   * Whether the tree view is showing `path`: it lies under the panel's folder
   * and every folder between the two is open. Folders opened and then left
   * behind by navigating elsewhere stay remembered, but are not shown.
   */
  private isShownInTree(group: PanelGroupState, path: string): boolean {
    if (this.viewFor(group) !== 'tree' || path === group.path) {
      return false;
    }
    const under = group.path === '' ? path !== '' : path.startsWith(`${group.path}/`);
    if (!under) {
      return false;
    }

    const open = this.expandedIn(group.id);
    for (let folder = parentOf(path); folder !== group.path; folder = parentOf(folder)) {
      if (!open.has(folder)) {
        return false;
      }
    }
    return true;
  }

  /** The open folders the tree view is currently showing. */
  private openFoldersShown(group: PanelGroupState): readonly string[] {
    return [...this.expandedIn(group.id)].filter((path) => this.isShownInTree(group, path));
  }

  /** What a tab showing `path` is called: its folder, or the root's name. */
  labelFor(path: string): string {
    return path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path);
  }

  /* -- view models -------------------------------------------------------- */

  private toViewModel(group: PanelGroupState, tab: PanelTabState, active: boolean): UiFileBrowserModel {
    return tab.kind === 'file' ? this.fileViewModel(group, tab) : this.folderViewModel(group, active);
  }

  /**
   * A folder tab's toolbar: Back and Forward along the panel's trail — each
   * disabled when there is nowhere to go — Up, Refresh, and what can be made
   * or sent here (PRD 003, §5).
   */
  private folderToolbar(group: PanelGroupState): readonly UiIconAction[] {
    const history = this.parent.panelHistoryFt;
    return [
      { id: 'back', label: 'Back (Alt+Left)', icon: 'arrow-left', ...(history.canGoBack(group.id) ? {} : { disabled: true }) },
      {
        id: 'forward',
        label: 'Forward (Alt+Right)',
        icon: 'arrow-right',
        ...(history.canGoForward(group.id) ? {} : { disabled: true }),
      },
      { id: 'up', label: 'Up one level (Alt+Up)', icon: 'arrow-up', ...(group.path === '' ? { disabled: true } : {}) },
      { id: 'refresh', label: 'Refresh listing (Ctrl+R)', icon: 'refresh' },
      { id: 'new-file', label: 'New file…', icon: 'file-plus' },
      { id: 'new-folder', label: 'New folder… (Ctrl+Shift+N)', icon: 'folder-plus' },
      { id: 'upload', label: 'Upload files', icon: 'upload' },
    ];
  }

  /** A folder tab: the listing, its toolbar and its states. */
  private folderViewModel(group: PanelGroupState, active: boolean): UiFileBrowserModel {
    const state = this.parent.fsDataFt.listingState(group.path);
    const all = this.parent.fsDataFt.entries(group.path);
    // A large folder with no order worked out yet is not shown in the disk's order, to jump a moment later.
    if (state?.listing && !this.parent.listingOrderFt.ready(group.path, all, this.sortOf(group.id))) {
      return this.sortingViewModel(group, all.length);
    }
    const entries = this.visibleEntries(group.id, group.path);
    const filter = this.filterOf(group.id);
    const view = this.viewFor(group);

    return {
      breadcrumbs: this.breadcrumbsOf(group.path),
      location: shownPath(group.path),
      locationSuggestions: this.locationSuggestionsFor(group.id),
      // `Escape` stops a large folder being read (PRD 004, §3.1.4).
      ...(state?.large && state.status === 'loading' ? { stoppable: true } : {}),
      view,
      toolbarActions: this.folderToolbar(group),
      showViewSwitch: true,
      searchPlaceholder: FILTER_PLACEHOLDER,
      filterText: filter,
      sortable: true,
      ...this.focusTokens(group.id),
      columns: columnsFor(this.sortOf(group.id)),
      // Only what the view shows: a folder of a million entries is a million of each (PRD 004, §3.1).
      rows:
        view === 'tree'
          ? this.treeRows(group, group.path, 0, active)
          : view === 'list'
            ? this.rowsOf(entries, group, active)
            : [],
      items: view === 'grid' ? this.itemsOf(entries, group, active) : [],
      // Kept through a reload, like the rows: the count changes when the answer does.
      ...(state?.listing ? { summary: this.summary(entries.length, all.length, filter, state.progress, state.large, state.stopped), dropFolder: true } : {}),
      ...this.placeholder(state, entries.length, all.length, filter),
    };
  }

  /** A large folder whose order the Web Worker is still working out (PRD 004, §3.1). */
  private sortingViewModel(group: PanelGroupState, count: number): UiFileBrowserModel {
    return {
      breadcrumbs: this.breadcrumbsOf(group.path),
      location: shownPath(group.path),
      view: this.viewFor(group),
      toolbarActions: this.folderToolbar(group),
      showViewSwitch: true,
      searchPlaceholder: FILTER_PLACEHOLDER,
      filterText: this.filterOf(group.id),
      sortable: true,
      ...this.focusTokens(group.id),
      columns: columnsFor(this.sortOf(group.id)),
      rows: [],
      items: [],
      empty: { icon: 'clock', title: `Sorting ${count.toLocaleString('en-US')} entries…`, hint: 'A large folder is put in order in the background.' },
    };
  }

  /**
   * A file tab: the rendered document, or the notice explaining why it is not
   * shown. Either way it lists nothing, so rows and items stay empty and the
   * list/grid switch is hidden.
   */
  private fileViewModel(group: PanelGroupState, tab: PanelTabState): UiFileBrowserModel {
    const preview = this.parent.filePreviewFt;
    const document = preview.documentFor(tab.path);
    const notice = preview.noticeFor(tab.path);

    return {
      breadcrumbs: this.breadcrumbsOf(tab.path),
      location: shownPath(tab.path),
      ...this.focusTokens(group.id),
      view: group.view,
      toolbarActions: this.fileToolbar(),
      columns: COLUMNS,
      rows: [],
      items: [],
      ...(document ? { document } : {}),
      ...(notice ? { empty: notice } : {}),
      // On its way: an empty body, not an empty file table where the document will go.
      ...(!document && !notice ? { pending: true } : {}),
    };
  }

  /**
   * What the body shows when there is nothing to list. Returns an empty object
   * rather than `{ empty: undefined }` so the spread stays compatible with
   * `exactOptionalPropertyTypes`.
   */
  private focusTokens(groupId: string): Pick<UiFileBrowserModel, 'filterFocus' | 'locationEdit'> {
    const requests = this.focusRequests()[groupId];
    return requests === undefined ? {} : { filterFocus: requests.filter, locationEdit: requests.location };
  }

  /** A file tab's toolbar: back to its folder, re-read, save, and open it outside the app. */
  private fileToolbar(): readonly UiIconAction[] {
    return [
      ...FILE_TOOLBAR,
      { id: 'open-external', label: this.parent.systemOpenFt.openLabel(), icon: 'external' },
    ];
  }

  private placeholder(
    state: FsListingState | undefined,
    count: number,
    total: number,
    filter: string,
  ): Pick<UiFileBrowserModel, 'empty'> | Record<string, never> {
    if (state?.status === 'error') {
      return {
        empty: {
          icon: 'alert-triangle',
          title: 'Could not open this folder',
          hint: state.error?.message ?? 'The server refused the request.',
        },
      };
    }
    // A large folder whose names are still being read (PRD 004, §3.1), with nothing of it to show yet.
    if (!state?.listing && state?.large) {
      const named = state.progress?.named ?? 0;
      return {
        empty: {
          icon: 'clock',
          title: 'Reading the entries of this folder…',
          hint: named === 0 ? 'A large folder is read in the background.' : `${named.toLocaleString('en-US')} names so far`,
        },
      };
    }
    if (state?.stopped && total === 0) {
      return { empty: { icon: 'clock', title: 'Reading this folder was stopped', hint: 'Refresh (Ctrl+R) to read it.' } };
    }
    if (state?.listing && count === 0 && total > 0 && filter.trim() !== '') {
      return {
        empty: {
          icon: 'filter',
          title: `No items match '${filter.trim()}'`,
          hint: `Clear the filter to see all ${total} ${total === 1 ? 'item' : 'items'}.`,
        },
      };
    }
    if (state?.listing && count === 0) {
      return { empty: EMPTY_FOLDER };
    }
    return {};
  }

  /**
   * `6 items` — or, while a filter hides some, `2 of 6 items`; and while a
   * large folder's details are still coming (PRD 004, §3.1), how far along.
   */
  private summary(count: number, total: number, filter: string, progress?: FsListingProgressState, large?: true, stopped?: true): string {
    const noun = total === 1 ? 'item' : 'items';
    const items =
      filter.trim() === '' || count === total
        ? `${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'}`
        : `${count.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${noun}`;
    if (stopped) {
      // Stopped with `Escape` (§3.1.4): what is listed may not be all there is.
      return `${items} · stopped, refresh to read it all`;
    }
    if (progress === undefined || progress.named === 0) {
      // Not watched (PRD 004, §3.1.1): say so, or a stale listing would pass for a live one.
      return large ? `${items} · refresh by hand` : items;
    }
    if (!progress.namesDone) {
      return `${items} · reading…`;
    }
    return `${items} · details ${Math.floor((progress.detailed / progress.named) * 100)}%`;
  }

  /** The path bar's crumbs for `path`: the root, then each folder on the way. */
  breadcrumbsOf(path: string): readonly UiBreadcrumb[] {
    const root: UiBreadcrumb = {
      id: 'root',
      label: this.parent.workspaceName(),
      icon: 'desktop',
    };
    const segments = path.split('/').filter(Boolean);
    return [
      root,
      ...segments.map((label, index) => ({ id: segments.slice(0, index + 1).join('/'), label })),
    ];
  }

  /**
   * The tree view's rows, flattened depth first: each folder's entries, with an
   * open folder's own entries straight after it, one level deeper.
   */
  private treeRows(group: PanelGroupState, path: string, depth: number, active: boolean): UiFileRow[] {
    const open = this.expandedIn(group.id);
    const filtering = this.filterOf(group.id).trim() !== '';
    const matches = nameFilter(this.filterOf(group.id));
    // Unfiltered here: an open folder whose own name does not match stays, for
    // the matches inside it; `visibleEntries` still gives the panel's order.
    const entries = this.ordered(path, this.sortOf(group.id));
    const selection = new Set(group.selection);
    return entries.flatMap((entry) => {
      const expandable = isFolder(entry);
      const expanded = expandable && open.has(entry.path);
      // Busy only while there is nothing to list yet; a reload keeps the children up.
      const state = expanded ? this.parent.fsDataFt.listingState(entry.path) : undefined;
      const loading = state?.status === 'loading' && !state.listing;
      const row: UiFileRow = {
        ...this.row(entry, group, active, selection, expanded),
        depth,
        expandable,
        ...(expandable ? { expanded } : {}),
        ...(loading ? { busy: true } : {}),
      };
      const children = expanded ? this.treeRows(group, entry.path, depth + 1, active) : [];
      if (filtering && !matches(entry.name) && children.length === 0) {
        return [];
      }
      return [row, ...children];
    });
  }

  /**
   * A listing's rows. The entries' own parts are made once per listing
   * (`baseRows`); what the panel adds — selected, focused, cut — is laid over
   * a copy, on the few rows it concerns. So moving the cursor through a folder
   * of a million (PRD 004, §3.1) costs a copy of an array, not a million rows.
   */
  private rowsOf(entries: readonly FsEntry[], group: PanelGroupState, active: boolean): UiFileRow[] {
    const made = this.baseRows(entries);
    const rows = made.rows.slice();
    const selection = new Set(group.selection);
    for (const [, at] of this.placesOf(this.flagged(group, active), entries, made)) {
      rows[at] = this.row(entries[at] as FsEntry, group, active, selection);
    }
    return rows;
  }

  /**
   * Where `paths` are among `entries`. A few are looked for from the top; many
   * — everything selected — through an index of every path, made then and
   * kept with the rows, which for one cursor in a million entries would be
   * the dearer of the two.
   */
  private placesOf(paths: ReadonlySet<string>, entries: readonly FsEntry[], made: { index?: Map<string, number> }): [string, number][] {
    if (paths.size === 0) {
      return [];
    }
    if (paths.size > 8 || made.index !== undefined) {
      made.index ??= new Map(entries.map((entry, at) => [entry.path, at]));
      const index = made.index;
      return [...paths].flatMap((path) => {
        const at = index.get(path);
        return at === undefined ? [] : [[path, at] as [string, number]];
      });
    }
    const found: [string, number][] = [];
    for (let at = 0; at < entries.length && found.length < paths.size; at++) {
      const path = (entries[at] as FsEntry).path;
      if (paths.has(path)) {
        found.push([path, at]);
      }
    }
    return found;
  }

  /** The icon view's tiles, made as the rows are: the entries' own parts once, the panel's laid over a few. */
  private itemsOf(entries: readonly FsEntry[], group: PanelGroupState, active: boolean): UiIconViewItem[] {
    const made = this.baseItems(entries);
    const items = made.items.slice();
    const selection = new Set(group.selection);
    const paths = this.flagged(group, active);
    for (const path of this.parent.thumbnailsFt.paths()) {
      paths.add(path);
    }
    for (const [, at] of this.placesOf(paths, entries, made)) {
      items[at] = this.item(entries[at] as FsEntry, group, active, selection);
    }
    return items;
  }

  private baseItems(entries: readonly FsEntry[]): BaseItems {
    let made = this.itemLists.get(entries);
    if (made === undefined) {
      const delta = deltaOf(entries);
      const before = delta === undefined ? undefined : this.itemLists.get(delta.from);
      if (delta !== undefined && before !== undefined) {
        const items = before.items.slice();
        for (const at of delta.changed) {
          items[at] = this.itemBase(entries[at] as FsEntry);
        }
        for (let at = delta.from.length; at < entries.length; at++) {
          items.push(this.itemBase(entries[at] as FsEntry));
          before.index?.set((entries[at] as FsEntry).path, at);
        }
        made = before.index === undefined ? { items } : { items, index: before.index };
      } else {
        made = { items: entries.map((entry) => this.itemBase(entry)) };
      }
      this.itemLists.set(entries, made);
    }
    return made;
  }

  private readonly itemLists = new WeakMap<readonly FsEntry[], BaseItems>();

  /** The paths whose rows the panel draws differently: selected, focused, cut. */
  private flagged(group: PanelGroupState, active: boolean): Set<string> {
    const paths = new Set(group.selection);
    if (active && group.focusedEntryId !== undefined) {
      paths.add(group.focusedEntryId);
    }
    for (const path of this.parent.fileClipboardFt.cutSet()) {
      paths.add(path);
    }
    return paths;
  }

  /** The rows of `entries` with nothing laid over them, and where each path's row is — made once per array. */
  private baseRows(entries: readonly FsEntry[]): BaseRows {
    let made = this.rowLists.get(entries);
    if (made === undefined) {
      // The rows last made, a few of their entries described and some added since (PRD 004, §3.1):
      // those few made again, the added ones made after them.
      const delta = deltaOf(entries);
      const before = delta === undefined ? undefined : this.rowLists.get(delta.from);
      if (delta !== undefined && before !== undefined) {
        const rows = before.rows.slice();
        for (const at of delta.changed) {
          rows[at] = this.rowBase(entries[at] as FsEntry);
        }
        for (let at = delta.from.length; at < entries.length; at++) {
          rows.push(this.rowBase(entries[at] as FsEntry));
          before.index?.set((entries[at] as FsEntry).path, at);
        }
        made = before.index === undefined ? { rows } : { rows, index: before.index };
      } else {
        // In another order — a new sort, a large folder's order come in: the same rows, found again.
        made = { rows: entries.map((entry) => this.rowBase(entry)) };
      }
      this.rowLists.set(entries, made);
    }
    return made;
  }

  private readonly rowLists = new WeakMap<readonly FsEntry[], BaseRows>();

  /**
   * A row: the entry's own parts — labels, icon, tint — made once per entry
   * object and kept (an entry is a new object when anything about it changes),
   * so a listing of a million redrawn once a second formats nothing twice
   * (PRD 004, §3.1). What depends on the panel is laid over them, and a row
   * with none of it is the kept object itself.
   */
  private row(entry: FsEntry, group: PanelGroupState, active: boolean, selection: ReadonlySet<string>, expanded = false): UiFileRow {
    const base = expanded ? this.rowBaseOf(entry, true) : this.rowBase(entry);
    const selected = selection.has(entry.path);
    const focused = active && group.focusedEntryId === entry.path;
    const cut = this.parent.fileClipboardFt.isCut(entry.path);
    if (!selected && !focused && !cut) {
      return base;
    }
    return {
      ...base,
      ...(selected && active ? { selected: true } : {}),
      ...(selected && !active ? { inactiveSelected: true } : {}),
      ...(focused ? { focused: true } : {}),
      ...(cut ? { cut: true } : {}),
    };
  }

  private readonly itemBases = new WeakMap<FsEntry, UiIconViewItem>();
  private readonly rowBases = new WeakMap<FsEntry, UiFileRow>();

  /** An entry's row, made once per entry object and found again when the listing is put in another order. */
  private rowBase(entry: FsEntry): UiFileRow {
    let row = this.rowBases.get(entry);
    if (row === undefined) {
      row = this.rowBaseOf(entry, false);
      this.rowBases.set(entry, row);
    }
    return row;
  }

  /**
   * What a row shows of the entry alone; a folder takes drops (PRD 005, §2).
   * Its cells are worked out when first read — which the list does only for
   * the rows near its viewport — so a folder of a million (PRD 004, §3.1) is
   * a million small objects, not a million sizes and dates formatted.
   */
  private rowBaseOf(entry: FsEntry, expanded: boolean): UiFileRow {
    const files = this.parent.fileViewModel;
    return {
      id: entry.path,
      name: entry.name,
      icon: files.icon(entry, expanded),
      tint: files.tint(entry),
      cells: new RowCells(entry, files) as unknown as Readonly<Record<string, string>>,
      ...(entry.hidden ? { decoration: 'ignored' as const } : {}),
      ...(isFolder(entry) ? { dropTarget: true as const } : {}),
    };
  }

  private itemBase(entry: FsEntry): UiIconViewItem {
    let base = this.itemBases.get(entry);
    if (base === undefined) {
      const files = this.parent.fileViewModel;
      base = {
        id: entry.path,
        label: entry.name,
        icon: files.icon(entry),
        tint: files.tint(entry),
        ...(isFolder(entry) ? { dropTarget: true as const } : {}),
      };
      this.itemBases.set(entry, base);
    }
    return base;
  }

  private item(entry: FsEntry, group: PanelGroupState, active: boolean, selection: ReadonlySet<string>): UiIconViewItem {
    const base = this.itemBase(entry);
    const thumbnail = this.parent.thumbnailsFt.urlFor(entry);
    const selected = selection.has(entry.path);
    const focused = active && group.focusedEntryId === entry.path;
    const cut = this.parent.fileClipboardFt.isCut(entry.path);
    if (thumbnail === undefined && !selected && !focused && !cut) {
      return base;
    }
    return {
      ...base,
      ...(thumbnail === undefined ? {} : { thumbnail }),
      ...(selected ? { selected: true } : {}),
      ...(focused ? { focused: true } : {}),
      ...(cut ? { cut: true } : {}),
    };
  }
}
