import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiIconName, UiIconTint } from '../../models/icon.model';
import type { UiDropZone, UiTabDrop, UiTabMove, UiTabReorder } from '../../models/interaction.model';
import type { UiPanelGroupModel, UiTab } from '../../models/panel.model';
import type { UiGroupState, UiNewTab, UiPanelContentDef, UiPanelContentDriver, UiTabState } from '../ui-editor.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

/**
 * The panels' groups and their tabs (PRD 001, §1; PRD 002, §2), and every
 * operation that rearranges them: choosing, closing, reordering and moving
 * tabs, splitting and removing groups. The shape of the split layout lives in
 * `UiPanelLayout`.
 *
 * What a tab *shows* is not decided here. Each tab kind maps to a kind of
 * panel content (`UiPanelContentDef`), drawn by the application, whose
 * feature this asks — through `UiPanelContentDriver`, registered with
 * `registerContent` — when a tab needs loading and what the group frame
 * should show about it.
 *
 * A group is the application's `TGroup`: the library keeps its `tabs`, and an
 * application keeps the rest — what a group lists, how — by overriding the
 * hooks below (`remember`, `recall`, `follow`, `blankGroup`, `newTabFrom`,
 * `groupAdded`, `groupRemoved`, `tabChosen`).
 */
export class UiEditorGroupsFeature<TTab extends UiTabState = UiTabState, TGroup extends UiGroupState<TTab> = UiGroupState<TTab>> {
  protected readonly groups: WritableSignal<readonly TGroup[]>;

  /** Feeds `createId`; group ids must stay unique for the layout tree. */
  private groupSeq = 0;

  private readonly drivers = new Map<string, UiPanelContentDriver<TTab, TGroup>>();

  constructor(protected readonly parent: UiWorkbenchService<TTab, TGroup>) {
    this.groups = signal(parent.layout.groups);
    // Past every id already in use — tabs are named after it too — since a
    // restored session's may have gaps (PRD 003, §6).
    const ids = parent.layout.groups.flatMap((group) => [group.id, ...group.tabs.map((tab) => tab.id)]);
    this.groupSeq = Math.max(parent.layout.groups.length, ...ids.map((id) => Number(/group-(\d+)$/.exec(id)?.[1] ?? 0)));
  }

  /** What draws the tabs of a kind of content, at run time — the application's feature behind it. */
  registerContent(type: string, driver: UiPanelContentDriver<TTab, TGroup>): void {
    this.drivers.set(type, driver);
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

  isActive(id: string): boolean {
    return this.parent.activeGroupId() === id;
  }

  /** The content a kind of tab is drawn by. */
  contentDefOf(kind: string): UiPanelContentDef | undefined {
    return this.parent.config.editor.contents.find((content) => content.kinds.includes(kind));
  }

  /**
   * Which content the group's active tab is rendered by, or `null` for a group
   * with no tabs — the shell's choice of the application's content template.
   */
  activeContent(id: string): string | null {
    const group = this.stateOf(id);
    const tab = group ? this.activeTabOf(group) : undefined;
    return tab ? (this.contentDefOf(tab.kind)?.type ?? null) : null;
  }

  /** Whether the group's active tab takes files dropped from the system. */
  acceptsFiles(id: string): boolean {
    const group = this.stateOf(id);
    const tab = group ? this.activeTabOf(group) : undefined;
    return tab ? (this.contentOf(tab)?.acceptsFiles?.(tab) ?? false) : false;
  }

  /** Loads whatever the restored groups are showing. */
  start(): void {
    for (const group of this.groups()) {
      this.groupAdded(group, 'start');
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

  stateOf(id: string): TGroup | undefined {
    return this.groups().find((group) => group.id === id);
  }

  activeTabOf(group: TGroup): TTab | undefined {
    return group.tabs.find((tab) => tab.active) ?? group.tabs[0];
  }

  /** Replaces one group's state; any other group is left as it is. */
  update(id: string, change: (group: TGroup) => TGroup): void {
    this.groups.update((groups) => groups.map((group) => (group.id === id ? change(group) : group)));
  }

  /**
   * Replaces a group's tabs, with `activeId` (or the tab already active)
   * becoming the one it shows. See `withTabs` for what follows from that.
   */
  setTabs(id: string, tabs: readonly TTab[], activeId?: string): void {
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
  openBeside(groupId: string, zone: Exclude<UiDropZone, 'center'>, makeTab: (newGroupId: string) => TTab): string | undefined {
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
  openTab(groupId: string, tab: UiNewTab<TTab>): string | undefined {
    if (!this.stateOf(groupId)) {
      return undefined;
    }
    const id = `tab-${this.createId()}`;
    this.update(groupId, (group) => ({ ...group, tabs: [...group.tabs, { ...tab, id } as unknown as TTab] }));
    this.selectTab(groupId, id);
    return id;
  }

  /** A new tab in this group where it is (PRD 002, §2.2: `Ctrl`+`T`), and the keyboard with it. */
  newTab(groupId: string): void {
    const group = this.stateOf(groupId);
    if (!group) {
      return;
    }
    const tab = this.newTabFrom(group, this.activeTabOf(group));
    if (tab !== null && this.openTab(groupId, tab) !== undefined) {
      this.parent.panelFocusFt.focusBody(groupId);
    }
  }

  /** What a new tab of `group` shows: the active one again, by default; `null` for no new tab. */
  protected newTabFrom(_group: TGroup, active: TTab | undefined): UiNewTab<TTab> | null {
    if (active === undefined) {
      return null;
    }
    const { id: _id, active: _active, remembered: _remembered, openedFrom: _openedFrom, ...rest } = active;
    return rest as unknown as UiNewTab<TTab>;
  }

  /**
   * Where an entry opened "in the other panel" goes (PRD 002, §2.5): with two
   * panels, the other one; with more, the panel active before this one — or,
   * when that has gone, the next panel in layout order. `undefined` with no
   * other panel.
   */
  otherGroupOf(groupId: string): string | undefined {
    const ids = this.parent.panelLayoutFt.groupIds();
    const others = ids.filter((id) => id !== groupId);
    if (others.length <= 1) {
      return others[0];
    }
    const previous = this.parent.previousGroupId();
    if (previous !== null && others.includes(previous)) {
      return previous;
    }
    const at = ids.indexOf(groupId);
    return at === -1 ? others[0] : ids[(at + 1) % ids.length];
  }

  /**
   * Notes on the tab `groupId` shows that `fromTabId` opened it, so closing it
   * goes back there (see `closeTab`; PRD 002, §2.5.1).
   */
  markOpenedFrom(groupId: string, fromTabId: string): void {
    this.update(groupId, (group) => {
      const active = this.activeTabOf(group);
      return active === undefined || active.id === fromTabId
        ? group
        : { ...group, tabs: group.tabs.map((tab) => (tab.id === active.id ? { ...tab, openedFrom: fromTabId } : tab)) };
    });
  }

  selectTab(groupId: string, tabId: string): void {
    const before = this.stateOf(groupId);
    this.groups.update((groups) => groups.map((group) => (group.id === groupId ? this.withTabs(group, group.tabs, tabId) : group)));
    const group = this.stateOf(groupId);
    if (group) {
      this.loadGroupContent(group);
      if (before !== undefined && this.activeTabOf(before)?.id !== tabId) {
        this.tabChosen(group);
      }
    }
    this.focus(groupId);
  }

  /**
   * Closes a tab — once its content agrees (`canClose`): a tab with unsaved
   * changes asks first (PRD 005, §4), and stays open if the answer is no.
   */
  closeTab(groupId: string, tabId: string): void {
    const tab = this.stateOf(groupId)?.tabs.find((candidate) => candidate.id === tabId);
    const verdict = tab === undefined ? true : (this.contentOf(tab)?.canClose?.(tab) ?? true);
    if (verdict === true) {
      this.removeTab(groupId, tabId);
    } else if (verdict !== false) {
      void verdict.then((close) => close && this.removeTab(groupId, tabId));
    }
  }

  private removeTab(groupId: string, tabId: string): void {
    const group = this.stateOf(groupId);
    if (!group) {
      return;
    }

    const openedFrom = group.tabs.find((tab) => tab.id === tabId)?.openedFrom;
    const tabs = group.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length > 0) {
      this.groups.update((groups) => groups.map((candidate) => (candidate.id === groupId ? this.withTabs(candidate, tabs) : candidate)));
    } else {
      this.removeGroup(groupId);
    }

    // A tab opened from another goes back, closed, to the tab it was opened
    // from (PRD 002, §2.5.1) — wherever that is now, while it is still open.
    const origin = openedFrom === undefined ? undefined : this.groups().find((candidate) => candidate.tabs.some((tab) => tab.id === openedFrom));
    if (origin !== undefined && openedFrom !== undefined) {
      this.selectTab(origin.id, openedFrom);
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
    this.groups.update((groups) => groups.map((candidate) => (candidate.id === groupId ? { ...candidate, tabs } : candidate)));
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
        groups.map((candidate) => (candidate.id === source.id ? this.withTabs(candidate, this.insertBefore(rest, tab, drop.beforeTabId), tab.id) : candidate)),
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
      ...groups.map((candidate) => (candidate.id === source.id ? this.withTabs(candidate, remaining) : candidate)),
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

    // A copy was opened by no one: closing it goes nowhere in particular (PRD 002, §2.5.1).
    const { openedFrom: _openedFrom, ...copy } = active;
    const newGroupId = this.openBeside(groupId, zone, (id) => ({ ...copy, id: `${active.id}-${id}` }) as unknown as TTab);
    if (newGroupId === undefined) {
      return;
    }
    // The new panel is where the work continues, so the keyboard goes with it
    // — otherwise `/` leaves focus behind in the panel it split.
    this.parent.panelFocusFt.focusBody(newGroupId);
  }

  /* -- group bookkeeping -------------------------------------------------- */

  /** The application's feature behind whatever a tab shows. */
  protected contentOf(tab: TTab): UiPanelContentDriver<TTab, TGroup> | undefined {
    const type = this.contentDefOf(tab.kind)?.type;
    return type === undefined ? undefined : this.drivers.get(type);
  }

  /** Loads the tab a group is showing. */
  private loadGroupContent(group: TGroup): void {
    const active = this.activeTabOf(group);
    if (active) {
      this.loadTab(active);
    }
  }

  private removeGroup(groupId: string): void {
    this.groupRemoved(groupId);
    if (this.parent.previousGroupId() === groupId) {
      this.parent.previousGroupId.set(null);
    }
    const remaining = this.groups().filter((group) => group.id !== groupId);

    if (remaining.length === 0) {
      const empty = this.parent.config.editor.emptyGroup(this.createId());
      this.groupAdded(empty, 'empty');
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
  private transfer(source: TGroup, target: TGroup, tab: TTab, beforeTabId: string | null): void {
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
  private loadTab(tab: TTab): void {
    this.contentOf(tab)?.load?.(tab);
  }

  private insertBefore(tabs: readonly TTab[], tab: TTab, beforeTabId: string | null): readonly TTab[] {
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
   * Rewrites a group's tab set: exactly one tab ends up active.
   *
   * Choosing another tab is not leaving for good (PRD 001, Fix 4): the tab
   * being left keeps what `remember` says of the group, and the tab being
   * chosen gets back what it had (`recall`). Otherwise the group follows its
   * active tab (`follow`).
   */
  protected withTabs(group: TGroup, tabs: readonly TTab[], activeId?: string): TGroup {
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs.find((tab) => tab.active) ?? tabs[0];
    const previous = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
    const switching = previous !== undefined && active !== undefined && previous.id !== active.id;
    const leaving = switching ? this.remember(group) : undefined;
    const normalized = tabs.map((tab): TTab => {
      const { remembered, ...rest } = tab;
      if (tab.id === active?.id) {
        // In use again: what it remembered is the group's now.
        return { ...rest, active: true } as unknown as TTab;
      }
      if (switching && tab.id === previous.id) {
        return { ...rest, active: false, ...(leaving === undefined ? {} : { remembered: leaving }) } as unknown as TTab;
      }
      return { ...rest, active: false, ...(remembered === undefined ? {} : { remembered }) } as unknown as TTab;
    });
    const recalled = switching && active.remembered !== undefined ? this.recall(group, normalized, active, active.remembered) : null;
    return recalled ?? this.follow(group, normalized, active, switching);
  }

  /** What a tab keeps of its group when another tab of it is chosen; `undefined` for nothing. */
  protected remember(_group: TGroup): unknown {
    return undefined;
  }

  /** The group as the chosen tab had it, from what it kept — or `null` when it cannot be. */
  protected recall(_group: TGroup, _tabs: readonly TTab[], _active: TTab, _memory: unknown): TGroup | null {
    return null;
  }

  /** The group with its new tabs, following the active one — the application's fields as they follow it. */
  protected follow(group: TGroup, tabs: readonly TTab[], _active: TTab | undefined, _switching: boolean): TGroup {
    return { ...group, tabs };
  }

  /** A new group that inherits its neighbour's configuration. */
  private cloneGroup(source: TGroup, id: string, tabs: readonly TTab[]): TGroup {
    const group = this.withTabs(this.blankGroup(source, id), tabs);
    this.groupAdded(group, 'split');
    return group;
  }

  /** A group with no tabs yet, made from `source` — its view of things kept, what it was doing dropped. */
  protected blankGroup(source: TGroup, id: string): TGroup {
    return { ...source, id, tabs: [] };
  }

  /** A group appears: one restored as the workbench starts, one split off, or the empty one left when the last tab closes. */
  protected groupAdded(_group: TGroup, _reason: 'start' | 'split' | 'empty'): void {
    // The application's.
  }

  /** A group goes. */
  protected groupRemoved(_groupId: string): void {
    // The application's.
  }

  /** A tab other than the one it showed was chosen in `group`. */
  protected tabChosen(_group: TGroup): void {
    // The application's.
  }

  /* -- view models -------------------------------------------------------- */

  /**
   * The group frame: its tabs, its tab-bar actions and whether the active
   * tab's content is still arriving. What that content looks like is the
   * content feature's model, rendered inside the frame.
   */
  private toViewModel(group: TGroup): UiPanelGroupModel {
    const active = this.activeTabOf(group);
    if (!active) {
      return { id: group.id, tabs: [], actions: [], empty: this.parent.config.editor.emptyState };
    }

    return {
      id: group.id,
      tabs: group.tabs.map((tab) => this.tabOf(tab)),
      actions: this.tabBarActions(group),
      ...(this.contentOf(active)?.isLoading?.(group, active) ? { loading: true } : {}),
    };
  }

  private tabOf(tab: TTab): UiTab {
    return {
      id: tab.id,
      label: tab.label,
      ...this.tabIcon(tab),
      ...(tab.active ? { active: true } : {}),
      ...(this.contentOf(tab)?.isDirty?.(tab) ? { dirty: true } : {}),
    };
  }

  /** A tab's icon: its driver's (`tabIcon`), else its content's. */
  protected tabIcon(tab: TTab): { readonly icon: UiIconName; readonly tint?: UiIconTint } {
    return this.contentOf(tab)?.tabIcon?.(tab) ?? { icon: this.contentDefOf(tab.kind)?.icon ?? 'file' };
  }

  private tabBarActions(group: TGroup): readonly UiIconAction[] {
    const maximized = this.parent.panelLayoutFt.isMaximized(group.id);
    return [
      { id: 'split-right', label: 'Split right', icon: 'columns' },
      { id: 'split-down', label: 'Split down', icon: 'rows' },
      { id: 'maximize', label: maximized ? 'Restore group' : 'Maximize group', icon: 'maximize', active: maximized },
    ];
  }
}
