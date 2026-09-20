import { computed, signal, type WritableSignal } from '@angular/core';
import type {
  UiBreadcrumb,
  UiFileColumn,
  UiFileRow,
  UiIconAction,
  UiIconViewItem,
  UiPanelGroupModel,
  UiPanelView,
  UiTab,
  UiTabDrop,
  UiTabMove,
  UiTabReorder,
} from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import type { FsListingState } from './fs-data.feature';
import type { PanelGroupState, PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

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

const NO_TABS = {
  icon: 'folder-open',
  title: 'Open a folder to browse it here',
  hint: 'or drag a tab onto this group',
  keys: ['Ctrl', 'O'],
} as const;

const EMPTY_FOLDER = {
  icon: 'folder-open',
  title: 'This folder is empty',
  hint: 'Drop files here to upload them',
} as const;

/**
 * The editor area: which groups exist, what each one lists, and every
 * operation that rearranges them.
 *
 * Groups and tabs live here; the shape of the split layout lives in
 * `PanelLayoutFeature`, and the directory contents come from the shared
 * `FsDataFeature` cache. A group only ever *reads* that cache while rendering —
 * fetches are started by the actions below, never by a computed.
 */
export class EditorGroupsFeature {
  private readonly groups: WritableSignal<readonly PanelGroupState[]>;

  /** Feeds `createGroupId`; group ids must stay unique for the layout tree. */
  private groupSeq = 0;

  constructor(private readonly parent: WorkbenchService) {
    this.groups = signal(parent.mockWorkbench.layout.groups);
    this.groupSeq = parent.mockWorkbench.layout.groups.length;
  }

  /** View models keyed by group id, so the grid's leaf template is a lookup. */
  readonly groupsById = computed<Readonly<Record<string, UiPanelGroupModel>>>(() => {
    const activeGroupId = this.parent.activeGroupId();
    const entries = this.groups().map(
      (group) => [group.id, this.toViewModel(group, group.id === activeGroupId)] as const,
    );
    return Object.fromEntries(entries);
  });

  /** Lookup used by the grid's leaf template. */
  group(id: string): UiPanelGroupModel | undefined {
    return this.groupsById()[id];
  }

  /** Directory a group is listing — where its uploads land. */
  pathOf(id: string): string | undefined {
    return this.groups().find((group) => group.id === id)?.path;
  }

  isActive(id: string): boolean {
    return this.parent.activeGroupId() === id;
  }

  /** Loads whatever the restored groups are showing. */
  start(): void {
    for (const group of this.groups()) {
      this.loadGroupContent(group);
    }
  }

  /** Lists a folder tab's directory, or reads a file tab's file. */
  private loadGroupContent(group: PanelGroupState): void {
    const active = this.activeTab(group);
    if (!active) {
      return;
    }
    if (active.kind === 'file') {
      this.parent.filePreviewFt.load(active.path);
      return;
    }
    this.parent.fsDataFt.ensureListing(active.path);
  }

  private activeTab(group: PanelGroupState): PanelTabState | undefined {
    return group.tabs.find((tab) => tab.active) ?? group.tabs[0];
  }

  focus(id: string): void {
    if (this.parent.activeGroupId() !== id) {
      this.parent.activeGroupId.set(id);
    }
  }

  setView(id: string, view: UiPanelView): void {
    this.groups.update((groups) => groups.map((group) => (group.id === id ? { ...group, view } : group)));
  }

  /** Selects an entry inside a group; the details sidebar follows. */
  selectEntry(groupId: string, entryId: string): void {
    this.groups.update((groups) =>
      groups.map((group) =>
        group.id === groupId ? { ...group, selection: [entryId], focusedEntryId: entryId } : group,
      ),
    );
    this.focus(groupId);
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
      return;
    }
    this.focus(groupId);
    this.parent.filePreviewFt.open(entry.path);
  }

  /* -- toolbar ----------------------------------------------------------- */

  runToolbarAction(groupId: string, actionId: string): void {
    const group = this.find(groupId);
    const active = group ? this.activeTab(group) : undefined;
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
    const group = this.find(groupId);
    const active = group ? this.activeTab(group) : undefined;
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
    const group = this.find(groupId);
    if (!group) {
      return;
    }

    const existing = group.tabs.find((tab) => tab.kind === 'file' && tab.path === path);
    const tabs = existing
      ? group.tabs
      : [...group.tabs, { id: `tab-file-${this.createGroupId()}`, label, path, kind: 'file' as const }];
    const activeId = existing?.id ?? tabs[tabs.length - 1]?.id;

    this.groups.update((groups) =>
      groups.map((candidate) => (candidate.id === groupId ? this.withTabs(candidate, tabs, activeId) : candidate)),
    );
    this.focus(groupId);
  }

  /**
   * Shows a folder in a group, giving it a tab when it has none.
   *
   * A group whose active tab is a *file* gets a new folder tab instead of
   * having the preview rewritten underneath it: opening a folder in the
   * sidebar should never throw away the file someone is reading.
   */
  openFolder(groupId: string, path: string, label: string): void {
    const group = this.find(groupId);
    if (!group) {
      return;
    }

    const active = this.activeTab(group);
    if (active && active.kind === 'folder') {
      this.navigateTo(groupId, path, label);
      return;
    }

    // A folder tab for this very path is reused rather than duplicated; only
    // then is a new one opened beside the preview.
    const existing = group.tabs.find((tab) => tab.kind === 'folder' && tab.path === path);
    const tab: PanelTabState = existing ?? {
      id: `tab-${this.createGroupId()}`,
      label,
      path,
      kind: 'folder',
    };
    const tabs = existing ? group.tabs : [...group.tabs, tab];

    this.groups.update((groups) =>
      groups.map((candidate) =>
        candidate.id === groupId ? this.withTabs(candidate, tabs, tab.id) : candidate,
      ),
    );
    this.parent.fsDataFt.ensureListing(path);
    this.focus(groupId);
  }

  /** Points a group and its active tab at another folder. */
  navigateTo(groupId: string, path: string, label: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
        // Navigating turns the active tab into a folder tab, which is what
        // "up one level" from a file preview means.
        const tabs = active
          ? group.tabs.map((tab) =>
              tab.id === active.id ? { ...tab, label, path, kind: 'folder' as const } : tab,
            )
          : group.tabs;
        return { ...group, tabs, path, selection: [] };
      }),
    );
    this.parent.fsDataFt.ensureListing(path);
    this.focus(groupId);
  }

  /* -- tabs -------------------------------------------------------------- */

  selectTab(groupId: string, tabId: string): void {
    this.groups.update((groups) =>
      groups.map((group) => (group.id === groupId ? this.withTabs(group, group.tabs, tabId) : group)),
    );
    const group = this.find(groupId);
    if (group) {
      this.loadGroupContent(group);
    }
    this.focus(groupId);
  }

  closeTab(groupId: string, tabId: string): void {
    const group = this.find(groupId);
    if (!group) {
      return;
    }

    const tabs = group.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length > 0) {
      this.groups.update((groups) =>
        groups.map((candidate) => (candidate.id === groupId ? this.withTabs(candidate, tabs) : candidate)),
      );
      return;
    }

    this.removeGroup(groupId);
  }

  moveTab(groupId: string, move: UiTabMove): void {
    const group = this.find(groupId);
    if (!group) {
      return;
    }
    const from = group.tabs.findIndex((tab) => tab.id === move.tabId);
    const to = from + move.direction;
    if (from === -1 || to < 0 || to >= group.tabs.length) {
      return;
    }
    const tabs = [...group.tabs];
    const [moved] = tabs.splice(from, 1);
    if (moved) {
      tabs.splice(to, 0, moved);
    }
    this.groups.update((groups) =>
      groups.map((candidate) => (candidate.id === groupId ? { ...candidate, tabs } : candidate)),
    );
  }

  /** A tab dropped on a tab bar: a reorder at home, a move anywhere else. */
  applyReorder(drop: UiTabReorder): void {
    const source = this.find(drop.groupId);
    const target = this.find(drop.targetGroupId);
    const tab = source?.tabs.find((candidate) => candidate.id === drop.tabId);
    if (!source || !target || !tab) {
      return;
    }

    if (source.id === target.id) {
      const rest = source.tabs.filter((candidate) => candidate.id !== tab.id);
      this.groups.update((groups) =>
        groups.map((candidate) =>
          candidate.id === source.id
            ? this.withTabs(candidate, this.insertBefore(rest, tab, drop.beforeTabId), tab.id)
            : candidate,
        ),
      );
      this.focus(target.id);
      return;
    }

    this.transfer(source, target, tab, drop.beforeTabId);
  }

  /**
   * A tab dropped on a group's body: `center` joins the group, an edge zone
   * divides it and gives the new half the tab.
   */
  applyZoneDrop(drop: UiTabDrop): void {
    if (drop.zone === 'center') {
      this.applyReorder({ ...drop, beforeTabId: null });
      return;
    }

    const source = this.find(drop.groupId);
    const target = this.find(drop.targetGroupId);
    const tab = source?.tabs.find((candidate) => candidate.id === drop.tabId);
    if (!source || !target || !tab) {
      return;
    }

    // Dividing a group with its own only tab would just move it sideways.
    if (source.id === target.id && source.tabs.length === 1) {
      return;
    }

    const newGroupId = this.createGroupId();
    const remaining = source.tabs.filter((candidate) => candidate.id !== tab.id);

    this.groups.update((groups) => [
      ...groups.map((candidate) =>
        candidate.id === source.id ? this.withTabs(candidate, remaining) : candidate,
      ),
      this.cloneGroup(target, newGroupId, [tab]),
    ]);

    this.parent.panelLayoutFt.insertBeside(target.id, newGroupId, drop.zone);
    this.parent.activeGroupId.set(newGroupId);
    this.loadTab(tab);

    if (remaining.length === 0) {
      this.removeGroup(source.id);
    }
  }

  /** Files dropped from the desktop onto a group land in its directory. */
  uploadInto(groupId: string, files: readonly File[]): void {
    const group = this.find(groupId);
    if (!group || files.length === 0) {
      return;
    }
    this.focus(groupId);
    this.parent.transfersFt.uploadFiles(group.path, files);
  }

  /* -- tab bar actions --------------------------------------------------- */

  runAction(groupId: string, actionId: string): void {
    switch (actionId) {
      case 'split-right':
        this.splitActive(groupId, 'right');
        break;
      case 'split-down':
        this.splitActive(groupId, 'bottom');
        break;
      case 'maximize':
        this.parent.panelLayoutFt.toggleMaximize(groupId);
        break;
      default:
        break;
    }
  }

  /**
   * Divides a group beside its active tab, which is *copied* into the new
   * group — the same as VS Code's split, and the reason the split buttons are
   * safe to press: nothing is taken away from the group you pressed them in.
   * Dragging a tab onto an edge is the gesture that moves it instead.
   */
  private splitActive(groupId: string, zone: 'right' | 'bottom'): void {
    const group = this.find(groupId);
    const active = group?.tabs.find((tab) => tab.active) ?? group?.tabs[0];
    if (!group || !active) {
      return;
    }

    const newGroupId = this.createGroupId();
    const copy: PanelTabState = { ...active, id: `${active.id}-${newGroupId}` };
    this.groups.update((groups) => [...groups, this.cloneGroup(group, newGroupId, [copy])]);
    this.parent.panelLayoutFt.insertBeside(groupId, newGroupId, zone);
    this.parent.activeGroupId.set(newGroupId);
  }

  /* -- group bookkeeping -------------------------------------------------- */

  private find(id: string): PanelGroupState | undefined {
    return this.groups().find((group) => group.id === id);
  }

  private entryIn(groupId: string, entryId: string): FsEntry | undefined {
    const group = this.find(groupId);
    return group
      ? this.parent.fsDataFt.entries(group.path).find((entry) => entry.path === entryId)
      : undefined;
  }

  private createGroupId(): string {
    this.groupSeq += 1;
    return `group-${this.groupSeq}`;
  }

  private removeGroup(groupId: string): void {
    const remaining = this.groups().filter((group) => group.id !== groupId);

    if (remaining.length === 0) {
      const empty = this.emptyGroup(this.createGroupId());
      this.groups.set([empty]);
      this.parent.panelLayoutFt.reset(empty.id);
      this.parent.activeGroupId.set(empty.id);
      return;
    }

    this.groups.set(remaining);
    this.parent.panelLayoutFt.remove(groupId);

    if (this.parent.activeGroupId() === groupId) {
      const next = this.parent.panelLayoutFt.groupIds()[0] ?? remaining[0]?.id;
      if (next) {
        this.parent.activeGroupId.set(next);
      }
    }
  }

  /** Moves a tab from one group to another, pruning the source if it empties. */
  private transfer(
    source: PanelGroupState,
    target: PanelGroupState,
    tab: PanelTabState,
    beforeTabId: string | null,
  ): void {
    const remaining = source.tabs.filter((candidate) => candidate.id !== tab.id);

    this.groups.update((groups) =>
      groups.map((candidate) => {
        if (candidate.id === source.id) {
          return this.withTabs(candidate, remaining);
        }
        if (candidate.id === target.id) {
          return this.withTabs(candidate, this.insertBefore(target.tabs, tab, beforeTabId), tab.id);
        }
        return candidate;
      }),
    );

    this.parent.activeGroupId.set(target.id);
    this.loadTab(tab);

    if (remaining.length === 0) {
      this.removeGroup(source.id);
    }
  }

  /** Reads whatever one tab shows, wherever it has just landed. */
  private loadTab(tab: PanelTabState): void {
    if (tab.kind === 'file') {
      this.parent.filePreviewFt.load(tab.path);
      return;
    }
    this.parent.fsDataFt.ensureListing(tab.path);
  }

  private insertBefore(
    tabs: readonly PanelTabState[],
    tab: PanelTabState,
    beforeTabId: string | null,
  ): readonly PanelTabState[] {
    const next = [...tabs];
    const at = beforeTabId === null ? -1 : next.findIndex((candidate) => candidate.id === beforeTabId);
    if (at === -1) {
      next.push(tab);
    } else {
      next.splice(at, 0, tab);
    }
    return next;
  }

  /**
   * Rewrites a group's tab set: exactly one tab ends up active, and the group
   * follows it to its folder. A group that changed folder drops its selection,
   * because those paths belong to the previous listing.
   */
  private withTabs(
    group: PanelGroupState,
    tabs: readonly PanelTabState[],
    activeId?: string,
  ): PanelGroupState {
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs.find((tab) => tab.active) ?? tabs[0];
    const normalized = tabs.map((tab) => ({ ...tab, active: tab.id === active?.id }));
    const path = active?.path ?? group.path;
    const samePath = path === group.path;

    return {
      ...group,
      tabs: normalized,
      path,
      selection: samePath ? group.selection : [],
      ...(samePath && group.focusedEntryId !== undefined ? { focusedEntryId: group.focusedEntryId } : {}),
    };
  }

  /** A new group that inherits its neighbour's view configuration. */
  private cloneGroup(source: PanelGroupState, id: string, tabs: readonly PanelTabState[]): PanelGroupState {
    return this.withTabs({ ...source, id, selection: [], tabs: [] }, tabs);
  }

  private emptyGroup(id: string): PanelGroupState {
    return { id, path: '', view: 'list', selection: [], tabs: [] };
  }

  private labelFor(path: string): string {
    return path === '' ? this.parent.mockWorkbench.workspaceName : (path.split('/').at(-1) ?? path);
  }

  /* -- view models -------------------------------------------------------- */

  private toViewModel(group: PanelGroupState, active: boolean): UiPanelGroupModel {
    const activeTab = this.activeTab(group);
    return activeTab?.kind === 'file'
      ? this.fileViewModel(group, activeTab)
      : this.folderViewModel(group, active);
  }

  /** A group showing a directory: the listing, its toolbar and its states. */
  private folderViewModel(group: PanelGroupState, active: boolean): UiPanelGroupModel {
    const hasTabs = group.tabs.length > 0;
    const state = hasTabs ? this.parent.fsDataFt.listingState(group.path) : undefined;
    const entries = hasTabs ? this.parent.fsDataFt.entries(group.path) : [];

    return {
      id: group.id,
      tabs: this.tabs(group),
      actions: hasTabs ? this.tabBarActions(group) : [],
      breadcrumbs: hasTabs ? this.breadcrumbs(group.path) : [],
      view: group.view,
      toolbarActions: hasTabs ? FOLDER_TOOLBAR : [],
      ...(hasTabs ? { showViewSwitch: true } : {}),
      ...(state?.status === 'loading' ? { loading: true } : {}),
      columns: COLUMNS,
      rows: entries.map((entry) => this.row(entry, group, active)),
      items: entries.map((entry) => this.item(entry, group)),
      ...(hasTabs && state?.status === 'ready' ? { summary: this.summary(entries.length) } : {}),
      ...this.placeholder(group, state, entries.length),
    };
  }

  /**
   * A group showing one file: the rendered document, or the notice explaining
   * why it is not shown. Either way it lists nothing, so rows and items stay
   * empty and the list/grid switch is hidden.
   */
  private fileViewModel(group: PanelGroupState, tab: PanelTabState): UiPanelGroupModel {
    const preview = this.parent.filePreviewFt;
    const document = preview.documentFor(tab.path);
    const notice = preview.noticeFor(tab.path);

    return {
      id: group.id,
      tabs: this.tabs(group),
      actions: this.tabBarActions(group),
      breadcrumbs: this.breadcrumbs(tab.path),
      view: group.view,
      toolbarActions: FILE_TOOLBAR,
      ...(preview.isLoading(tab.path) ? { loading: true } : {}),
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
    group: PanelGroupState,
    state: FsListingState | undefined,
    count: number,
  ): Pick<UiPanelGroupModel, 'empty'> | Record<string, never> {
    if (group.tabs.length === 0) {
      return { empty: NO_TABS };
    }
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

  private tabs(group: PanelGroupState): readonly UiTab[] {
    const files = this.parent.fileViewModel;
    return group.tabs.map((tab) => {
      const isFile = tab.kind === 'file';
      return {
        id: tab.id,
        label: tab.label,
        icon: isFile ? ('file' as const) : ('folder' as const),
        tint: isFile ? files.tint({ type: 'file', name: tab.label }) : ('folder' as const),
        ...(tab.active ? { active: true } : {}),
      };
    });
  }

  private tabBarActions(group: PanelGroupState): readonly UiIconAction[] {
    const maximized = this.parent.panelLayoutFt.isMaximized(group.id);
    return [
      { id: 'split-right', label: 'Split right', icon: 'columns' },
      { id: 'split-down', label: 'Split down', icon: 'rows' },
      {
        id: 'maximize',
        label: maximized ? 'Restore group' : 'Maximize group',
        icon: 'maximize',
        active: maximized,
      },
    ];
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

  private item(entry: FsEntry, group: PanelGroupState): UiIconViewItem {
    const files = this.parent.fileViewModel;
    return {
      id: entry.path,
      label: entry.name,
      icon: files.icon(entry),
      tint: files.tint(entry),
      ...(group.selection.includes(entry.path) ? { selected: true } : {}),
    };
  }
}
