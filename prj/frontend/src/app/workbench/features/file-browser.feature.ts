import { computed } from '@angular/core';
import type {
  UiBreadcrumb,
  UiFileBrowserModel,
  UiFileColumn,
  UiFileRow,
  UiIconAction,
  UiIconViewItem,
  UiPanelView,
} from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import type { PanelContentFeature } from '../panel-content.model';
import { PANEL_CONTENT, type PanelGroupState, type PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';
import type { EditorGroupsFeature } from './editor-groups.feature';
import type { FsListingState } from './fs-data.feature';

/** Columns of the list view; the backend supplies every value. */
const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name', sort: 'asc' },
  { key: 'size', label: 'Size', width: '90px', align: 'end' },
  { key: 'type', label: 'Type', width: '110px' },
  { key: 'modified', label: 'Modified', width: '150px' },
];

/** Toolbar of a folder tab: navigate, re-read, send files. */
const FOLDER_TOOLBAR: readonly UiIconAction[] = [
  { id: 'up', label: 'Up one level', icon: 'arrow-up' },
  { id: 'refresh', label: 'Refresh listing', icon: 'refresh' },
  { id: 'upload', label: 'Upload files', icon: 'upload' },
];

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
 */
export class FileBrowserFeature implements PanelContentFeature {
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

  /** Selects an entry inside a group; the details sidebar follows. */
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
    if (entry.type === 'directory') {
      this.navigateTo(groupId, entry.path, entry.name);
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
    const entry = this.entryIn(groupId, entryId);
    if (!entry) {
      return;
    }

    const directory = entry.type === 'directory';
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
      case 'up': {
        // From a file, "up" shows the folder that contains it.
        const from = active.kind === 'file' ? active.path : group.path;
        if (from === '') {
          return;
        }
        const parentPath = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
        this.openFolder(groupId, parentPath, this.labelFor(parentPath));
        break;
      }
      case 'refresh':
        if (active.kind === 'file') {
          this.parent.filePreviewFt.reload(active.path);
        } else {
          this.parent.fsDataFt.reloadListing(group.path);
        }
        break;
      case 'upload':
        this.parent.requestUpload(groupId);
        break;
      case 'download':
        this.parent.transfersFt.download(active.path, active.label);
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

    this.groups.setTabs(groupId, tabs, tab.id);
    this.parent.panelHistoryFt.record(groupId, path);
    this.parent.fsDataFt.ensureListing(path);
    this.groups.focus(groupId);
  }

  /** Points a group and its active tab at another folder. */
  navigateTo(groupId: string, path: string, label: string): void {
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
    this.parent.fsDataFt.ensureListing(path);
    this.groups.focus(groupId);
  }

  /** Files dropped from the desktop onto a panel land in its directory. */
  uploadInto(groupId: string, files: readonly File[]): void {
    const group = this.groups.stateOf(groupId);
    if (!group || files.length === 0) {
      return;
    }
    this.groups.focus(groupId);
    this.parent.transfersFt.uploadFiles(group.path, files);
  }

  private entryIn(groupId: string, entryId: string): FsEntry | undefined {
    const group = this.groups.stateOf(groupId);
    return group
      ? this.parent.fsDataFt.entries(group.path).find((entry) => entry.path === entryId)
      : undefined;
  }

  private labelFor(path: string): string {
    return path === '' ? this.parent.mockWorkbench.workspaceName : (path.split('/').at(-1) ?? path);
  }

  /* -- view models -------------------------------------------------------- */

  private toViewModel(group: PanelGroupState, tab: PanelTabState, active: boolean): UiFileBrowserModel {
    return tab.kind === 'file' ? this.fileViewModel(group, tab) : this.folderViewModel(group, active);
  }

  /** A folder tab: the listing, its toolbar and its states. */
  private folderViewModel(group: PanelGroupState, active: boolean): UiFileBrowserModel {
    const state = this.parent.fsDataFt.listingState(group.path);
    const entries = this.parent.fsDataFt.entries(group.path);

    return {
      breadcrumbs: this.breadcrumbs(group.path),
      view: group.view,
      toolbarActions: FOLDER_TOOLBAR,
      showViewSwitch: true,
      columns: COLUMNS,
      rows: entries.map((entry) => this.row(entry, group, active)),
      items: entries.map((entry) => this.item(entry, group, active)),
      ...(state?.status === 'ready' ? { summary: this.summary(entries.length) } : {}),
      ...this.placeholder(state, entries.length),
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
      view: group.view,
      toolbarActions: FILE_TOOLBAR,
      columns: COLUMNS,
      rows: [],
      items: [],
      ...(document ? { document } : {}),
      ...(notice ? { empty: notice } : {}),
    };
  }

  /**
   * What the body shows when there is nothing to list. Returns an empty object
   * rather than `{ empty: undefined }` so the spread stays compatible with
   * `exactOptionalPropertyTypes`.
   */
  private placeholder(
    state: FsListingState | undefined,
    count: number,
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
    if (state?.status === 'ready' && count === 0) {
      return { empty: EMPTY_FOLDER };
    }
    return {};
  }

  private summary(count: number): string {
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  }

  private breadcrumbs(path: string): readonly UiBreadcrumb[] {
    const root: UiBreadcrumb = {
      id: 'root',
      label: this.parent.mockWorkbench.workspaceName,
      icon: 'desktop',
    };
    const segments = path.split('/').filter(Boolean);
    return [
      root,
      ...segments.map((label, index) => ({ id: segments.slice(0, index + 1).join('/'), label })),
    ];
  }

  private row(entry: FsEntry, group: PanelGroupState, active: boolean): UiFileRow {
    const files = this.parent.fileViewModel;
    const selected = group.selection.includes(entry.path);
    return {
      id: entry.path,
      name: entry.name,
      icon: files.icon(entry),
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
    };
  }

  private item(entry: FsEntry, group: PanelGroupState, active: boolean): UiIconViewItem {
    const files = this.parent.fileViewModel;
    return {
      id: entry.path,
      label: entry.name,
      icon: files.icon(entry),
      tint: files.tint(entry),
      ...(group.selection.includes(entry.path) ? { selected: true } : {}),
      ...(active && group.focusedEntryId === entry.path ? { focused: true } : {}),
    };
  }
}
