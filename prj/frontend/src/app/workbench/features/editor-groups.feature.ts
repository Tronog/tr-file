import { computed, signal, type WritableSignal } from '@angular/core';
import type {
  UiDropZone,
  UiIconAction,
  UiPanelGroupModel,
  UiTab,
  UiTabDrop,
  UiTabMove,
  UiTabReorder,
} from '@tr-file/ui';
import type { PanelContentFeature } from '../panel-content.model';
import {
  PANEL_CONTENT,
  type PanelContentType,
  type PanelGroupState,
  type PanelTabMemory,
  type PanelTabState,
} from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

const NO_TABS = {
  icon: 'folder-open',
  title: 'Open a folder to browse it here',
  hint: 'or drag a tab onto this group',
  keys: ['Ctrl', 'O'],
} as const;

/**
 * The editor area's groups and their tabs, and every operation that
 * rearranges them: choosing, closing, reordering and moving tabs, splitting
 * and removing groups.
 *
 * What a tab *shows* is not decided here. Each tab kind maps to a kind of
 * panel content (`PANEL_CONTENT`), and each content has its own feature —
 * `FileBrowserFeature` for file management — which renders its own model and
 * changes groups only through the operations below. This feature asks it,
 * through `PanelContentFeature`, when a tab needs loading and what the group
 * frame should show about it. The shape of the split layout lives in
 * `PanelLayoutFeature`.
 */
export class EditorGroupsFeature {
  private readonly groups: WritableSignal<readonly PanelGroupState[]>;

  /** Feeds `createId`; group ids must stay unique for the layout tree. */
  private groupSeq = 0;

  constructor(private readonly parent: WorkbenchService) {
    this.groups = signal(parent.layout.groups);
    // Past every id already in use — tabs are named after it too — since a
    // restored session's may have gaps (PRD 003, §6).
    const ids = parent.layout.groups.flatMap((group) => [group.id, ...group.tabs.map((tab) => tab.id)]);
    this.groupSeq = Math.max(parent.layout.groups.length, ...ids.map((id) => Number(/group-(\d+)$/.exec(id)?.[1] ?? 0)));
  }

  /** Every group's state, for the content features that render them. */
  readonly states = computed(() => this.groups());

  /** Group frames keyed by group id, so the grid's leaf template is a lookup. */
  readonly groupsById = computed<Readonly<Record<string, UiPanelGroupModel>>>(() => {
    const entries = this.groups().map((group) => [group.id, this.toViewModel(group)] as const);
    return Object.fromEntries(entries);
  });

  /** Lookup used by the grid's leaf template. */
  group(id: string): UiPanelGroupModel | undefined {
    return this.groupsById()[id];
  }

  /** Path of a group's active tab — the directory its uploads land in. */
  pathOf(id: string): string | undefined {
    return this.stateOf(id)?.path;
  }

  isActive(id: string): boolean {
    return this.parent.activeGroupId() === id;
  }

  /**
   * Which content the group's active tab is rendered by, or `null` for a group
   * with no tabs — the template's switch between content components.
   */
  activeContent(id: string): PanelContentType | null {
    const group = this.stateOf(id);
    const tab = group ? this.activeTabOf(group) : undefined;
    return tab ? PANEL_CONTENT[tab.kind] : null;
  }

  /** Whether the group's active tab takes files dropped from the desktop. */
  acceptsFiles(id: string): boolean {
    const group = this.stateOf(id);
    const tab = group ? this.activeTabOf(group) : undefined;
    return tab ? this.contentOf(tab).acceptsFiles(tab) : false;
  }

  /** Loads whatever the restored groups are showing. */
  start(): void {
    for (const group of this.groups()) {
      // The folder a panel opens on is the first stop on its trail (§6.2.1),
      // or its very first Back would have nowhere to return to.
      this.parent.panelHistoryFt.record(group.id, group.path);
      this.loadGroupContent(group);
    }
  }

  focus(id: string): void {
    this.activate(id);
  }

  /**
   * Makes `id` the active group, remembering the one it takes over from as
   * the previous (PRD 002, §2.7). A group that has just been removed is not
   * remembered: there is nowhere left to send anything.
   */
  private activate(id: string): void {
    const current = this.parent.activeGroupId();
    if (current === id) {
      return;
    }
    if (this.stateOf(current) !== undefined) {
      this.parent.previousGroupId.set(current);
    }
    this.parent.activeGroupId.set(id);
  }

  /* -- operations for content features ----------------------------------- */

  stateOf(id: string): PanelGroupState | undefined {
    return this.groups().find((group) => group.id === id);
  }

  activeTabOf(group: PanelGroupState): PanelTabState | undefined {
    return group.tabs.find((tab) => tab.active) ?? group.tabs[0];
  }

  /** Replaces one group's state; any other group is left as it is. */
  update(id: string, change: (group: PanelGroupState) => PanelGroupState): void {
    this.groups.update((groups) => groups.map((group) => (group.id === id ? change(group) : group)));
  }

  /**
   * Replaces a group's tabs, with `activeId` (or the tab already active)
   * becoming the one it shows. See `withTabs` for what follows from that.
   */
  setTabs(id: string, tabs: readonly PanelTabState[], activeId?: string): void {
    this.update(id, (group) => this.withTabs(group, tabs, activeId));
  }

  /** A fresh id, unique across groups and the tabs named after them. */
  createId(): string {
    this.groupSeq += 1;
    return `group-${this.groupSeq}`;
  }

  /**
   * Opens a new group beside `groupId`, holding the one tab `makeTab` builds
   * for it, and makes it the active group. Returns the new group's id, or
   * `undefined` when `groupId` does not exist.
   *
   * Nothing is loaded and focus is not moved: the caller knows whether the tab
   * is new content to fetch, or a copy of something already on screen.
   */
  openBeside(
    groupId: string,
    zone: Exclude<UiDropZone, 'center'>,
    makeTab: (newGroupId: string) => PanelTabState,
  ): string | undefined {
    const group = this.stateOf(groupId);
    if (!group) {
      return undefined;
    }

    const newGroupId = this.createId();
    this.groups.update((groups) => [...groups, this.cloneGroup(group, newGroupId, [makeTab(newGroupId)])]);
    this.parent.panelLayoutFt.insertBeside(groupId, newGroupId, zone);
    this.activate(newGroupId);
    return newGroupId;
  }

  /* -- tabs -------------------------------------------------------------- */

  /**
   * Adds a tab to a group and chooses it — loaded, and the group made the
   * active one — as a click on it would. Returns the new tab's id.
   */
  openTab(groupId: string, tab: Omit<PanelTabState, 'id' | 'active' | 'remembered'>): string | undefined {
    if (!this.stateOf(groupId)) {
      return undefined;
    }
    const id = `tab-${this.createId()}`;
    this.update(groupId, (group) => ({ ...group, tabs: [...group.tabs, { ...tab, id }] }));
    this.selectTab(groupId, id);
    return id;
  }

  /**
   * `Ctrl`+`T` (PRD 002, §2.2): a new tab in this group where it is — as a
   * file manager's new tab opens on the folder you are in. A folder, a zip or
   * the trash is opened again; from a file or a diff, the folder it is in.
   * The keyboard goes with it.
   */
  newTab(groupId: string): void {
    const group = this.stateOf(groupId);
    if (!group) {
      return;
    }
    const active = this.activeTabOf(group);
    let tab: Omit<PanelTabState, 'id' | 'active' | 'remembered'>;
    if (active !== undefined && active.kind !== 'file' && active.kind !== 'diff') {
      const { id: _id, active: _active, remembered: _remembered, ...rest } = active;
      tab = rest;
    } else {
      const path = active === undefined ? group.path : active.path.includes('/') ? active.path.slice(0, active.path.lastIndexOf('/')) : '';
      tab = { label: path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path), path, kind: 'folder' };
    }
    if (this.openTab(groupId, tab) !== undefined) {
      this.parent.panelFocusFt.focusBody(groupId);
    }
  }

  /**
   * Where `Ctrl`+`Enter` sends an entry (PRD 002, §2.5): the panel active
   * before this one — the other side of a two-panel layout — or, when that
   * has gone, the next panel in layout order. `undefined` with no other panel.
   */
  otherGroupOf(groupId: string): string | undefined {
    const ids = this.parent.panelLayoutFt.groupIds();
    const previous = this.parent.previousGroupId();
    if (previous !== null && previous !== groupId && ids.includes(previous)) {
      return previous;
    }
    const at = ids.indexOf(groupId);
    const next = at === -1 ? undefined : ids[(at + 1) % ids.length];
    return next === groupId ? undefined : next;
  }

  selectTab(groupId: string, tabId: string): void {
    const before = this.stateOf(groupId);
    this.groups.update((groups) =>
      groups.map((group) => (group.id === groupId ? this.withTabs(group, group.tabs, tabId) : group)),
    );
    const group = this.stateOf(groupId);
    if (group) {
      this.loadGroupContent(group);
      // A tab given back its cursor (PRD 001, Fix 4): the details sidebar follows it, as it would a click.
      const cursor = group.focusedEntryId;
      if (cursor !== undefined && before !== undefined && this.activeTabOf(before)?.id !== tabId) {
        this.parent.select(cursor);
      }
    }
    this.focus(groupId);
  }

  closeTab(groupId: string, tabId: string): void {
    const group = this.stateOf(groupId);
    if (!group) {
      return;
    }

    const tabs = group.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length > 0) {
      this.groups.update((groups) =>
        groups.map((candidate) => (candidate.id === groupId ? this.withTabs(candidate, tabs) : candidate)),
      );
    } else {
      this.removeGroup(groupId);
    }

    // Whatever is left showing gets the keyboard: closing the tab someone was
    // standing in otherwise drops focus out of the workbench entirely. The
    // active group may have changed, so it is read back rather than assumed.
    this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
  }

  moveTab(groupId: string, move: UiTabMove): void {
    const group = this.stateOf(groupId);
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
    const source = this.stateOf(drop.groupId);
    const target = this.stateOf(drop.targetGroupId);
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

    const source = this.stateOf(drop.groupId);
    const target = this.stateOf(drop.targetGroupId);
    const tab = source?.tabs.find((candidate) => candidate.id === drop.tabId);
    if (!source || !target || !tab) {
      return;
    }

    // Dividing a group with its own only tab would just move it sideways.
    if (source.id === target.id && source.tabs.length === 1) {
      return;
    }

    const newGroupId = this.createId();
    const remaining = source.tabs.filter((candidate) => candidate.id !== tab.id);

    this.groups.update((groups) => [
      ...groups.map((candidate) =>
        candidate.id === source.id ? this.withTabs(candidate, remaining) : candidate,
      ),
      this.cloneGroup(target, newGroupId, [tab]),
    ]);

    this.parent.panelLayoutFt.insertBeside(target.id, newGroupId, drop.zone);
    this.activate(newGroupId);
    this.loadTab(tab);

    if (remaining.length === 0) {
      this.removeGroup(source.id);
    }
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
      case 'new-tab':
        this.newTab(groupId);
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
    const group = this.stateOf(groupId);
    const active = group ? this.activeTabOf(group) : undefined;
    if (!active) {
      return;
    }

    const newGroupId = this.openBeside(groupId, zone, (id) => ({ ...active, id: `${active.id}-${id}` }));
    if (newGroupId === undefined) {
      return;
    }
    // The new panel is where the work continues, so the keyboard goes with it
    // — otherwise `/` leaves focus behind in the panel it split.
    this.parent.panelFocusFt.focusBody(newGroupId);
  }

  /* -- group bookkeeping -------------------------------------------------- */

  /** The feature behind whatever a tab shows. */
  private contentOf(tab: PanelTabState): PanelContentFeature {
    switch (PANEL_CONTENT[tab.kind]) {
      case 'files':
        return this.parent.fileBrowserFt;
      case 'archive':
        return this.parent.archiveBrowserFt;
      case 'diff':
        return this.parent.gitDiffFt;
      case 'trash':
        return this.parent.trashFt;
    }
  }

  /** Loads the tab a group is showing. */
  private loadGroupContent(group: PanelGroupState): void {
    const active = this.activeTabOf(group);
    if (active) {
      this.loadTab(active);
    }
  }

  private removeGroup(groupId: string): void {
    this.parent.panelHistoryFt.forget(groupId);
    if (this.parent.previousGroupId() === groupId) {
      this.parent.previousGroupId.set(null);
    }
    const remaining = this.groups().filter((group) => group.id !== groupId);

    if (remaining.length === 0) {
      const empty = this.emptyGroup(this.createId());
      this.parent.panelHistoryFt.record(empty.id, empty.path);
      this.groups.set([empty]);
      this.parent.panelLayoutFt.reset(empty.id);
      this.activate(empty.id);
      return;
    }

    this.groups.set(remaining);
    this.parent.panelLayoutFt.remove(groupId);

    if (this.parent.activeGroupId() === groupId) {
      const next = this.parent.panelLayoutFt.groupIds()[0] ?? remaining[0]?.id;
      if (next) {
        this.activate(next);
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

    this.activate(target.id);
    this.loadTab(tab);

    if (remaining.length === 0) {
      this.removeGroup(source.id);
    }
  }

  /** Reads whatever one tab shows, wherever it has just landed. */
  private loadTab(tab: PanelTabState): void {
    this.contentOf(tab).load(tab);
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
   *
   * Choosing another tab is not leaving for good (PRD 001, Fix 4): the tab
   * being left keeps what was selected in it and where the cursor was, and
   * the tab being chosen gets back what it had — as long as it still shows
   * the folder it had it in.
   */
  private withTabs(
    group: PanelGroupState,
    tabs: readonly PanelTabState[],
    activeId?: string,
  ): PanelGroupState {
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs.find((tab) => tab.active) ?? tabs[0];
    const previous = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
    const switching = previous !== undefined && active !== undefined && previous.id !== active.id;
    const leaving: PanelTabMemory = {
      path: group.path,
      selection: group.selection,
      ...(group.focusedEntryId === undefined ? {} : { focusedEntryId: group.focusedEntryId }),
    };
    const normalized = tabs.map((tab): PanelTabState => {
      const { remembered, ...rest } = tab;
      if (tab.id === active?.id) {
        // In use again: what it remembered is the group's now.
        return { ...rest, active: true };
      }
      if (switching && tab.id === previous.id) {
        return { ...rest, active: false, remembered: leaving };
      }
      return { ...rest, active: false, ...(remembered === undefined ? {} : { remembered }) };
    });
    const path = active?.path ?? group.path;
    const samePath = path === group.path;
    const restored = switching && active.remembered?.path === path ? active.remembered : undefined;

    const { focusedEntryId, ...rest } = group;
    if (restored !== undefined) {
      return {
        ...rest,
        tabs: normalized,
        path,
        selection: restored.selection,
        ...(restored.focusedEntryId === undefined ? {} : { focusedEntryId: restored.focusedEntryId }),
      };
    }
    return {
      ...rest,
      tabs: normalized,
      path,
      selection: samePath && !switching ? group.selection : [],
      ...(samePath && !switching && focusedEntryId !== undefined ? { focusedEntryId } : {}),
    };
  }

  /** A new group that inherits its neighbour's view configuration. */
  private cloneGroup(source: PanelGroupState, id: string, tabs: readonly PanelTabState[]): PanelGroupState {
    const group = this.withTabs({ ...source, id, selection: [], tabs: [] }, tabs);
    // A panel born from a split starts its own trail where it was born, not
    // with its neighbour's — they are two places to work from now on. Only a
    // *folder* is a stop on that trail: Back into a file would ask the panel
    // to list one.
    if ((group.tabs.find((tab) => tab.active) ?? group.tabs[0])?.kind !== 'file') {
      this.parent.panelHistoryFt.record(id, group.path);
    }
    return group;
  }

  private emptyGroup(id: string): PanelGroupState {
    return { id, path: '', view: 'list', selection: [], tabs: [] };
  }

  /* -- view models -------------------------------------------------------- */

  /**
   * The group frame: its tabs, its tab-bar actions and whether the active
   * tab's content is still arriving. What that content looks like is the
   * content feature's model, rendered inside the frame.
   */
  private toViewModel(group: PanelGroupState): UiPanelGroupModel {
    const active = this.activeTabOf(group);
    if (!active) {
      return { id: group.id, tabs: [], actions: [], empty: NO_TABS };
    }

    return {
      id: group.id,
      tabs: this.tabs(group),
      actions: this.tabBarActions(group),
      ...(this.contentOf(active).isLoading(group, active) ? { loading: true } : {}),
    };
  }

  private tabs(group: PanelGroupState): readonly UiTab[] {
    const files = this.parent.fileViewModel;
    return group.tabs.map((tab) => {
      if (tab.kind === 'trash') {
        // The trash is not a folder of the root (PRD 001, §14.1): its own icon, untinted.
        return { id: tab.id, label: tab.label, icon: 'trash' as const, ...(tab.active ? { active: true } : {}) };
      }
      const isFile = tab.kind === 'file' || tab.kind === 'diff';
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
}
