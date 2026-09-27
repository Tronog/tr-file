import { computed, signal } from '@angular/core';
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
  UiSelectionChange,
} from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { nameFilter, sortEntries } from '../listing/listing-order';
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
import type { EditorGroupsFeature } from './editor-groups.feature';
import type { FsListingState } from './fs-data.feature';
import { isFolder } from '../../file-system/fs-entry-kind';

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

  constructor(private readonly parent: WorkbenchService) {}

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

  setView(id: string, view: UiPanelView): void {
    this.groups.update(id, (group) => ({ ...group, view }));
  }

  /* -- order and filter (PRD 003, §5) --------------------------------------- */

  /** How a panel orders its listing. */
  sortOf(groupId: string): PanelSort {
    return this.groups.stateOf(groupId)?.sort ?? DEFAULT_SORT;
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
    const matches = nameFilter(this.filterOf(groupId));
    const entries = this.parent.fsDataFt.entries(path).filter((entry) => matches(entry.name));
    return sortEntries(entries, this.sortOf(groupId), (entry) => this.parent.fileViewModel.typeLabel(entry));
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
      if (group.view === 'tree') {
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
   * A path typed into a panel's path bar (PRD 003, §5), absolute within the
   * workspace: a folder is shown in the panel, a file in the folder it is in —
   * selected, so it is where the keyboard lands. What is not there is said so.
   */
  async goToLocation(groupId: string, text: string): Promise<void> {
    const segments = text.trim().replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.');
    const shown = `/${segments.join('/')}`;
    if (segments.includes('..')) {
      await this.parent.modal.message({
        severity: 'error',
        message: `'${text.trim()}' is not a path this panel can go to.`,
        detail: "Leave out '..': type the folder's own path from / up, e.g. /docs/prd.",
      });
      return;
    }
    const path = segments.join('/');
    try {
      const details = await this.parent.fileSystem.readFt.details(path);
      if (isFolder(details)) {
        this.openFolder(groupId, path, this.labelFor(path));
      } else {
        const folder = parentOf(path);
        this.openFolder(groupId, folder, this.labelFor(folder));
        this.selectEntry(groupId, path);
      }
      this.parent.panelFocusFt.focusBody(groupId);
    } catch (error) {
      const failure = FsError.from(error);
      await this.parent.modal.message({
        severity: 'error',
        message: failure.code === 'NOT_FOUND' ? `There is no file or folder at '${shown}'.` : `Could not open '${shown}'.`,
        detail: failure.code === 'NOT_FOUND' ? 'Check the path, and try again.' : failure.message,
      });
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
   * cursor; a box that caught nothing leaves the cursor, and the sidebar,
   * where they were.
   */
  setSelection(groupId: string, change: UiSelectionChange): void {
    this.groups.update(groupId, (group) => ({
      ...group,
      selection: [...change.selected],
      ...(change.focused === null ? {} : { focusedEntryId: change.focused }),
    }));
    this.groups.focus(groupId);
    if (change.focused !== null) {
      this.parent.select(change.focused);
    }
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
   * Opens an entry in a new panel beside this one (PRD 001, §6.2.5).
   *
   * Unlike the split button, which copies the active tab, the new panel is
   * created *for* this entry: a folder gets its listing, a file gets its
   * viewer. The keyboard goes with it, because opening something aside is a
   * request to work in it.
   */
  openEntryAside(groupId: string, entryId: string): void {
    const entry = this.entryIn(groupId, entryId) ?? this.parent.fsDataFt.entryAt(entryId);
    if (!entry) {
      return;
    }

    const directory = isFolder(entry);
    const newGroupId = this.groups.openBeside(groupId, 'right', (id) => ({
      id: `tab-${id}`,
      label: entry.name,
      path: entry.path,
      kind: directory ? 'folder' : 'file',
    }));
    if (newGroupId === undefined) {
      return;
    }

    if (directory) {
      this.parent.fsDataFt.ensureListing(entry.path);
    } else {
      this.parent.select(entry.path);
      this.parent.filePreviewFt.load(entry.path);
    }

    this.parent.panelFocusFt.focusBody(newGroupId);
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
    if (this.groups.stateOf(groupId)?.path !== path) {
      this.setFilter(groupId, '');
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

    const own = this.parent.fsDataFt.entries(group.path).find((entry) => entry.path === entryId);
    if (own || !this.isShownInTree(group, entryId)) {
      return own;
    }
    return this.parent.fsDataFt.entries(parentOf(entryId)).find((entry) => entry.path === entryId);
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
    if (group.view !== 'tree' || path === group.path) {
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

  private labelFor(path: string): string {
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
      { id: 'refresh', label: 'Refresh listing (F5)', icon: 'refresh' },
      { id: 'new-file', label: 'New file…', icon: 'file-plus' },
      { id: 'new-folder', label: 'New folder… (Ctrl+Shift+N)', icon: 'folder-plus' },
      { id: 'upload', label: 'Upload files', icon: 'upload' },
    ];
  }

  /** A folder tab: the listing, its toolbar and its states. */
  private folderViewModel(group: PanelGroupState, active: boolean): UiFileBrowserModel {
    const state = this.parent.fsDataFt.listingState(group.path);
    const all = this.parent.fsDataFt.entries(group.path);
    const entries = this.visibleEntries(group.id, group.path);
    const filter = this.filterOf(group.id);

    return {
      breadcrumbs: this.breadcrumbs(group.path),
      location: `/${group.path}`,
      view: group.view,
      toolbarActions: this.folderToolbar(group),
      showViewSwitch: true,
      searchPlaceholder: FILTER_PLACEHOLDER,
      filterText: filter,
      sortable: true,
      ...this.focusTokens(group.id),
      columns: columnsFor(this.sortOf(group.id)),
      rows:
        group.view === 'tree'
          ? this.treeRows(group, group.path, 0, active)
          : entries.map((entry) => this.row(entry, group, active)),
      items: entries.map((entry) => this.item(entry, group, active)),
      // Kept through a reload, like the rows: the count changes when the answer does.
      ...(state?.listing ? { summary: this.summary(entries.length, all.length, filter), dropFolder: true } : {}),
      ...this.placeholder(state, entries.length, all.length, filter),
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
      breadcrumbs: this.breadcrumbs(tab.path),
      location: `/${tab.path}`,
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

  /** `6 items` — or, while a filter hides some, `2 of 6 items`. */
  private summary(count: number, total: number, filter: string): string {
    const noun = total === 1 ? 'item' : 'items';
    return filter.trim() === '' || count === total ? `${count} ${count === 1 ? 'item' : 'items'}` : `${count} of ${total} ${noun}`;
  }

  private breadcrumbs(path: string): readonly UiBreadcrumb[] {
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
    const entries = sortEntries(this.parent.fsDataFt.entries(path), this.sortOf(group.id), (entry) =>
      this.parent.fileViewModel.typeLabel(entry),
    );
    return entries.flatMap((entry) => {
      const expandable = isFolder(entry);
      const expanded = expandable && open.has(entry.path);
      // Busy only while there is nothing to list yet; a reload keeps the children up.
      const state = expanded ? this.parent.fsDataFt.listingState(entry.path) : undefined;
      const loading = state?.status === 'loading' && !state.listing;
      const row: UiFileRow = {
        ...this.row(entry, group, active, expanded),
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

  private row(entry: FsEntry, group: PanelGroupState, active: boolean, expanded = false): UiFileRow {
    const files = this.parent.fileViewModel;
    const selected = group.selection.includes(entry.path);
    return {
      id: entry.path,
      name: entry.name,
      icon: files.icon(entry, expanded),
      tint: files.tint(entry),
      cells: {
        size: files.sizeLabel(entry),
        type: files.typeLabel(entry),
        modified: files.modifiedLabel(entry),
      },
      ...(entry.hidden ? { decoration: 'ignored' as const } : {}),
      ...(selected && active ? { selected: true } : {}),
      ...(selected && !active ? { inactiveSelected: true } : {}),
      ...(active && group.focusedEntryId === entry.path ? { focused: true } : {}),
      ...this.dragFlags(entry),
    };
  }

  /** A folder takes drops; an entry on the clipboard to be moved is drawn faded (PRD 005, §2). */
  private dragFlags(entry: FsEntry): { dropTarget?: true; cut?: true } {
    return {
      ...(isFolder(entry) ? { dropTarget: true as const } : {}),
      ...(this.parent.fileClipboardFt.isCut(entry.path) ? { cut: true as const } : {}),
    };
  }

  private item(entry: FsEntry, group: PanelGroupState, active: boolean): UiIconViewItem {
    const files = this.parent.fileViewModel;
    const thumbnail = this.parent.thumbnailsFt.urlFor(entry);
    return {
      id: entry.path,
      label: entry.name,
      icon: files.icon(entry),
      tint: files.tint(entry),
      ...(thumbnail === undefined ? {} : { thumbnail }),
      ...(group.selection.includes(entry.path) ? { selected: true } : {}),
      ...(active && group.focusedEntryId === entry.path ? { focused: true } : {}),
      ...this.dragFlags(entry),
    };
  }
}
