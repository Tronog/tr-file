import { computed, signal, type WritableSignal } from '@angular/core';
import type {
  UiBreadcrumb,
  UiFileColumn,
  UiFileRow,
  UiGridNode,
  UiIconViewItem,
  UiPanelGroupModel,
  UiPanelView,
  UiTab,
} from '@tr-file/ui';
import type { MockFileNode, MockPanelGroup } from '../mock-data/mock-data.model';
import type { WorkbenchService } from '../workbench.service';

/** Column definitions the list view can show, keyed by the mock's column ids. */
const COLUMNS: Readonly<Record<string, UiFileColumn>> = {
  size: { key: 'size', label: 'Size', width: '90px', align: 'end' },
  type: { key: 'type', label: 'Type', width: '110px' },
  modified: { key: 'modified', label: 'Modified', width: '150px' },
};

/**
 * The editor area: which groups exist, how they are split, and what each one
 * lists.
 *
 * The split layout is data (`UiGridNode`), not markup, so moving, grouping and
 * dividing panels later are transformations of this tree rather than template
 * rewrites. PRD 001 keeps those transformations for a future section; what
 * exists here is the state they will operate on.
 */
export class EditorGroupsFeature {
  private readonly groups: WritableSignal<readonly MockPanelGroup[]>;

  /** The recursive split layout rendered by `ui-panel-grid`. */
  readonly grid: UiGridNode;

  constructor(private readonly parent: WorkbenchService) {
    this.groups = signal(parent.mockWorkbench.layout.groups);
    this.grid = parent.mockWorkbench.layout.grid;
  }

  /** View models keyed by group id, so the grid's leaf template is a lookup. */
  readonly groupsById = computed<Readonly<Record<string, UiPanelGroupModel>>>(() => {
    const activeGroupId = this.parent.activeGroupId();
    const entries = this.groups().map((group) => [group.id, this.toViewModel(group, group.id === activeGroupId)] as const);
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
    this.parent.activeGroupId.set(id);
  }

  /** Switches one group between the list and grid views. */
  setView(id: string, view: UiPanelView): void {
    this.groups.update((groups) => groups.map((group) => (group.id === id ? { ...group, view } : group)));
  }

  /** Selects an entry inside a group; the details sidebar follows. */
  selectEntry(groupId: string, entryId: string): void {
    this.groups.update((groups) =>
      groups.map((group) => (group.id === groupId ? { ...group, selection: [entryId], focusedEntryId: entryId } : group)),
    );
    this.parent.activeGroupId.set(groupId);
    this.parent.selectedEntryId.set(entryId);
  }

  private toViewModel(group: MockPanelGroup, active: boolean): UiPanelGroupModel {
    const entries = group.path ? this.parent.mockFileSystem.list(group.path) : [];
    return {
      id: group.id,
      tabs: this.tabs(group),
      actions: this.tabBarActions(group),
      breadcrumbs: this.breadcrumbs(group.path),
      view: group.view,
      toolbarActions: group.toolbar.actions,
      ...(group.toolbar.viewSwitch ? { showViewSwitch: true } : {}),
      ...(group.toolbar.search ? { searchPlaceholder: 'Filter files…' } : {}),
      columns: this.columns(group),
      rows: entries.map((entry) => this.row(entry, group, active)),
      items: entries.map((entry) => this.item(entry, group)),
      ...(group.view === 'grid' ? { summary: `${entries.length} items` } : {}),
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

  private tabBarActions(group: MockPanelGroup) {
    return group.view === 'grid'
      ? ([
          { id: 'split-down', label: 'Split down', icon: 'rows' },
          { id: 'more', label: 'More actions', icon: 'dots' },
        ] as const)
      : ([
          { id: 'split-right', label: 'Split right', icon: 'columns' },
          { id: 'split-down', label: 'Split down', icon: 'rows' },
          { id: 'maximize', label: 'Maximize group', icon: 'maximize' },
        ] as const);
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
