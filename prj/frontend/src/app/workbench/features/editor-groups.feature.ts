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
import type { MockFileNode, MockPanelGroup, MockPanelTab } from '../mock-data/mock-data.model';
import type { WorkbenchService } from '../workbench.service';

/** Column definitions the list view can show, keyed by the mock's column ids. */
const COLUMNS: Readonly<Record<string, UiFileColumn>> = {
  size: { key: 'size', label: 'Size', width: '90px', align: 'end' },
  type: { key: 'type', label: 'Type', width: '110px' },
  modified: { key: 'modified', label: 'Modified', width: '150px' },
};

/** Shown by a group that has no tabs left. */
const EMPTY_STATE = {
  icon: 'folder-open',
  title: 'Open a folder to browse it here',
  hint: 'or drag a tab onto this group',
  keys: ['Ctrl', 'O'],
} as const;

/**
 * The editor area: which groups exist, what each one lists, and every
 * operation that rearranges them.
 *
 * Groups and tabs live here; the shape of the split layout lives in
 * `PanelLayoutFeature`. Tab moves touch both — a tab leaving the last slot of a
 * group takes the group out of the layout with it — so all of those operations
 * are driven from this class and the layout feature stays a pure tree.
 */
export class EditorGroupsFeature {
  private readonly groups: WritableSignal<readonly MockPanelGroup[]>;

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

  isActive(id: string): boolean {
    return this.parent.activeGroupId() === id;
  }

  /** Focusing a group also moves the workbench-wide "active group" marker. */
  focus(id: string): void {
    if (this.parent.activeGroupId() !== id) {
      this.parent.activeGroupId.set(id);
    }
  }

  /** Switches one group between the list and grid views. */
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
    this.parent.selectedEntryId.set(entryId);
  }

  /* -- tabs -------------------------------------------------------------- */

  /** Activates a tab, which also re-points the group at that tab's folder. */
  selectTab(groupId: string, tabId: string): void {
    this.groups.update((groups) =>
      groups.map((group) => (group.id === groupId ? this.withTabs(group, group.tabs, tabId) : group)),
    );
    this.focus(groupId);
  }

  /**
   * Closes a tab. The group goes with its last tab; when the workbench runs out
   * of groups entirely, one empty group is left behind to drop tabs onto.
   */
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

  /**
   * Opens an entry from a panel body: a folder re-points the group (and its
   * active tab) at that folder, a file is merely selected. This is what makes
   * a panel a browser rather than a static listing.
   */
  openEntry(groupId: string, entryId: string): void {
    const entry = this.parent.mockFileSystem.find(entryId);
    if (entry?.kind === 'directory') {
      this.navigateTo(groupId, entry.id, entry.name);
      return;
    }
    this.selectEntry(groupId, entryId);
  }

  /** The toolbar's navigation buttons; unknown ids are ignored. */
  runToolbarAction(groupId: string, actionId: string): void {
    if (actionId !== 'up') {
      return;
    }
    const group = this.find(groupId);
    if (!group?.path) {
      return;
    }
    const parentPath = group.path.split('/').slice(0, -1).join('/');
    if (!parentPath) {
      return;
    }
    const name = parentPath.split('/').at(-1) ?? parentPath;
    this.navigateTo(groupId, parentPath, name);
  }

  /** Clicking a path segment walks the group back up to it. */
  openBreadcrumb(groupId: string, crumbId: string): void {
    // `root` and the `ws-*` segments sit above the workspace and are inert.
    if (crumbId === 'root' || crumbId.startsWith('ws-')) {
      return;
    }
    const name = crumbId.split('/').at(-1) ?? crumbId;
    this.navigateTo(groupId, crumbId, name);
  }

  /** Points a group and its active tab at another folder. */
  private navigateTo(groupId: string, path: string, label: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        const active = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
        const tabs = active
          ? group.tabs.map((tab) => (tab.id === active.id ? { ...tab, label, path } : tab))
          : group.tabs;
        return { ...group, tabs, path, selection: [] };
      }),
    );
    this.focus(groupId);
  }

  /** Keyboard reorder: moves a tab one slot along its own bar. */
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

    if (remaining.length === 0) {
      this.removeGroup(source.id);
    }
  }

  /* -- tab bar actions --------------------------------------------------- */

  /** Runs a tab-bar action: the keyboard-reachable half of drag and drop. */
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
    const copy: MockPanelTab = { ...active, id: `${active.id}-${newGroupId}` };
    this.groups.update((groups) => [...groups, this.cloneGroup(group, newGroupId, [copy])]);
    this.parent.panelLayoutFt.insertBeside(groupId, newGroupId, zone);
    this.parent.activeGroupId.set(newGroupId);
  }

  /* -- group bookkeeping -------------------------------------------------- */

  private find(id: string): MockPanelGroup | undefined {
    return this.groups().find((group) => group.id === id);
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
    source: MockPanelGroup,
    target: MockPanelGroup,
    tab: MockPanelTab,
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

    if (remaining.length === 0) {
      this.removeGroup(source.id);
    }
  }

  private insertBefore(
    tabs: readonly MockPanelTab[],
    tab: MockPanelTab,
    beforeTabId: string | null,
  ): readonly MockPanelTab[] {
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
   * because those entry ids belong to the previous listing.
   */
  private withTabs(
    group: MockPanelGroup,
    tabs: readonly MockPanelTab[],
    activeId?: string,
  ): MockPanelGroup {
    const active =
      tabs.find((tab) => tab.id === activeId) ?? tabs.find((tab) => tab.active) ?? tabs[0];
    const normalized = tabs.map((tab) => ({ ...tab, active: tab.id === active?.id }));
    const path = active?.path ?? (tabs.length === 0 ? '' : group.path);
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
  private cloneGroup(source: MockPanelGroup, id: string, tabs: readonly MockPanelTab[]): MockPanelGroup {
    return this.withTabs({ ...source, id, selection: [], tabs: [] }, tabs);
  }

  private emptyGroup(id: string): MockPanelGroup {
    return {
      id,
      path: '',
      view: 'list',
      selection: [],
      tabs: [],
      columns: ['size', 'modified'],
      toolbar: { actions: [], viewSwitch: false, search: false },
    };
  }

  /* -- view models -------------------------------------------------------- */

  private toViewModel(group: MockPanelGroup, active: boolean): UiPanelGroupModel {
    const entries = group.path ? this.parent.mockFileSystem.list(group.path) : [];
    const empty = group.tabs.length === 0;
    return {
      id: group.id,
      tabs: this.tabs(group),
      actions: this.tabBarActions(group),
      breadcrumbs: empty ? [] : this.breadcrumbs(group.path),
      view: group.view,
      toolbarActions: empty ? [] : group.toolbar.actions,
      ...(group.toolbar.viewSwitch && !empty ? { showViewSwitch: true } : {}),
      ...(group.toolbar.search && !empty ? { searchPlaceholder: 'Filter files…' } : {}),
      columns: this.columns(group),
      rows: entries.map((entry) => this.row(entry, group, active)),
      items: entries.map((entry) => this.item(entry, group)),
      ...(group.view === 'grid' && !empty ? { summary: `${entries.length} items` } : {}),
      ...(empty ? { empty: EMPTY_STATE } : {}),
    };
  }

  private tabs(group: MockPanelGroup): readonly UiTab[] {
    const files = this.parent.fileViewModel;
    return group.tabs.map((tab) => {
      const node = tab.path ? this.parent.mockFileSystem.find(tab.path) : undefined;
      return {
        id: tab.id,
        label: tab.label,
        icon: tab.icon ?? (node ? files.icon(node) : 'folder'),
        tint: node ? files.tint(node) : this.tintForTab(tab.label),
        ...(tab.active ? { active: true } : {}),
        ...(tab.preview ? { preview: true } : {}),
        ...(tab.dirty ? { dirty: true } : {}),
      } satisfies UiTab;
    });
  }

  private tabBarActions(group: MockPanelGroup): readonly UiIconAction[] {
    if (group.tabs.length === 0) {
      return [];
    }
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
    const root: UiBreadcrumb = { id: 'root', label: 'local', icon: 'desktop' };
    const workspace = this.parent.mockFileSystem.workspacePath.split('/').filter(Boolean);
    const segments = path.split('/').filter(Boolean);
    return [
      root,
      ...workspace.map((label, index) => ({ id: `ws-${index}`, label })),
      ...segments.map((label, index) => ({ id: segments.slice(0, index + 1).join('/'), label })),
    ];
  }

  private columns(group: MockPanelGroup): readonly UiFileColumn[] {
    return [
      { key: 'name', label: 'Name', sort: 'asc' },
      ...group.columns.map((key) => COLUMNS[key]).filter((column): column is UiFileColumn => column !== undefined),
    ];
  }

  private row(entry: MockFileNode, group: MockPanelGroup, active: boolean): UiFileRow {
    const files = this.parent.fileViewModel;
    const selected = group.selection.includes(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      icon: files.icon(entry),
      tint: files.tint(entry),
      cells: {
        size: files.sizeLabel(entry),
        type: files.typeLabel(entry),
        modified: files.modifiedLabel(entry),
      },
      ...(entry.decoration ? { decoration: entry.decoration } : {}),
      ...(selected && active ? { selected: true } : {}),
      ...(selected && !active ? { inactiveSelected: true } : {}),
      ...(active && group.focusedEntryId === entry.id ? { focused: true } : {}),
    };
  }

  private item(entry: MockFileNode, group: MockPanelGroup): UiIconViewItem {
    const files = this.parent.fileViewModel;
    return {
      id: entry.id,
      label: entry.name,
      icon: files.icon(entry),
      tint: files.tint(entry),
      ...(group.selection.includes(entry.id) ? { selected: true } : {}),
    };
  }

  /** Tabs without a path (search results) still deserve a sensible tint. */
  private tintForTab(label: string) {
    return label.toLowerCase().includes('result') ? ('generic' as const) : ('folder' as const);
  }
}
