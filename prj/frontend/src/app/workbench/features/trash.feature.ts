import { computed, signal } from '@angular/core';
import type {
  UiActionListItem,
  UiEmptyStateModel,
  UiFileBrowserModel,
  UiFileColumn,
  UiFileRow,
  UiIconAction,
  UiPreview,
  UiProperty,
  UiPropertyActivation,
  UiSelectionChange,
} from '@tr-file/ui';
import type { FsTrashItem, FsTrashListing } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { PanelContentFeature } from '../panel-content.model';
import { PANEL_CONTENT, type PanelGroupState, type PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';
import { shownPath } from '../../file-system/fs-path';

/** The Places row that opens the trash; not a path, so no folder can be mistaken for it. */
export const TRASH_PLACE = 'trash:';

const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'location', label: 'Original Location' },
  { key: 'deleted', label: 'Deleted', width: '150px' },
  { key: 'size', label: 'Size', width: '90px', align: 'end' },
];

interface TrashState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly listing?: FsTrashListing;
  readonly error?: FsError;
}

/** What a panel has selected in the trash. */
interface TrashSelection {
  readonly selected: readonly string[];
  readonly focused?: string;
}

/**
 * The trash (PRD 001, §14.1): a *Trash* row in the explorer's Places pane,
 * which opens it in a panel tab of its own kind (`trash`) — what was thrown
 * away, where it was and when, newest first — and, while a panel shows it,
 * the details sidebar's card for it, with *Empty Trash…* among its actions.
 *
 * Read-only, like a zip: entries leave the trash by *Restore*, where the trash
 * can put things back (the server's own), or all together by *Empty Trash* —
 * both the jobs `OperationsFeature` runs and asks about. A trash that cannot
 * be listed — the system's on macOS and Windows — says so, and can still be
 * emptied. The listing is read when shown, and again when a job that changes
 * the trash ends.
 */
export class TrashFeature implements PanelContentFeature {
  private readonly state = signal<TrashState | null>(null);
  private readonly selections = signal<Readonly<Record<string, TrashSelection>>>({});

  constructor(private readonly parent: WorkbenchService) {}

  /** What the trash is called here: the Recycle Bin on Windows' system trash, the Trash anywhere else. */
  readonly label = computed(() => {
    const listing = this.state()?.listing;
    return listing?.trash === 'system' && /Windows/i.test(globalThis.navigator?.userAgent ?? '') ? 'Recycle Bin' : 'Trash';
  });

  /* -- panel content --------------------------------------------------------- */

  load(): void {
    const state = this.state();
    if (state === null || state.status === 'error') {
      this.read();
    }
  }

  isLoading(): boolean {
    const state = this.state();
    return state?.status === 'loading' && state.listing === undefined;
  }

  acceptsFiles(): boolean {
    return false;
  }

  /** Reads the trash again — after a job that changed it, or when asked to. */
  reload(): void {
    if (this.state() !== null) {
      this.read();
    }
  }

  /** Opens the trash in a tab of the group, or goes back to the tab that has it. */
  open(groupId: string): void {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    if (group === undefined) {
      return;
    }
    const existing = group.tabs.find((tab) => tab.kind === 'trash');
    const tab: PanelTabState = existing ?? { id: `tab-trash-${groups.createId()}`, label: this.label(), path: '', kind: 'trash' };
    groups.setTabs(groupId, existing ? group.tabs : [...group.tabs, tab], tab.id);
    groups.focus(groupId);
    this.read();
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** Whether the active panel shows the trash — the details sidebar then describes it. */
  readonly showing = computed(() => {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(this.parent.activeGroupId());
    return group !== undefined && groups.activeTabOf(group)?.kind === 'trash';
  });

  /* -- the view ---------------------------------------------------------------- */

  readonly browsersById = computed<Readonly<Record<string, UiFileBrowserModel>>>(() => {
    const groups = this.parent.editorGroupsFt;
    const active = this.parent.activeGroupId();
    const entries = groups.states().flatMap((group) => {
      const tab = groups.activeTabOf(group);
      return tab && PANEL_CONTENT[tab.kind] === 'trash' ? [[group.id, this.toViewModel(group, group.id === active)] as const] : [];
    });
    return Object.fromEntries(entries);
  });

  browser(groupId: string): UiFileBrowserModel | undefined {
    return this.browsersById()[groupId];
  }

  setSelection(groupId: string, change: UiSelectionChange): void {
    this.selections.update((all) => ({
      ...all,
      [groupId]: { selected: change.selected, ...(change.focused === null ? {} : { focused: change.focused }) },
    }));
    this.parent.editorGroupsFt.focus(groupId);
  }

  runToolbarAction(groupId: string, actionId: string): void {
    switch (actionId) {
      case 'refresh':
        this.read();
        break;
      case 'restore':
        void this.restore(groupId);
        break;
      case 'empty':
        void this.parent.operationsFt.emptyTrash();
        break;
      default:
        break;
    }
  }

  /** The keys a panel reports, as far as the trash has a meaning for them. */
  runKey(groupId: string, command: string): void {
    if (command === 'refresh') {
      this.read();
    } else if (command === 'up') {
      // Nowhere above the trash: back to the folder the panel was on before it.
      this.parent.panelHistoryFt.back(groupId);
    }
  }

  /** Puts the selected entries back where they came from — the server's trash can. */
  async restore(groupId: string): Promise<void> {
    const ids = this.selectedIn(groupId);
    if (ids.length === 0 || this.state()?.listing?.canRestore !== true) {
      return;
    }
    await this.parent.operationsFt.restore(ids);
    this.selections.update((all) => ({ ...all, [groupId]: { selected: [] } }));
  }

  /* -- the details sidebar (PRD 001, §14.1) ---------------------------------------- */

  /** The one entry the active panel has picked in the trash, if one. */
  private readonly picked = computed<FsTrashItem | undefined>(() => {
    const selected = this.selectedIn(this.parent.activeGroupId());
    return selected.length === 1 ? this.items().find((item) => item.id === selected[0]) : undefined;
  });

  readonly preview = computed<UiPreview>(() => {
    const item = this.picked();
    const files = this.parent.fileViewModel;
    if (item !== undefined) {
      const entry = TrashFeature.asEntry(item);
      return {
        title: item.name,
        subtitle: `${files.typeLabel(entry)} · in the ${this.label()}`,
        icon: files.icon(entry),
        tint: files.tint(entry),
      };
    }
    const listing = this.state()?.listing;
    return {
      title: this.label(),
      subtitle: listing === undefined ? 'Reading…' : listing.canList ? this.countLabel() : 'Kept by the system',
      icon: 'trash',
    };
  });

  readonly properties = computed<readonly UiProperty[]>(() => {
    const files = this.parent.fileViewModel;
    const item = this.picked();
    if (item !== undefined) {
      return [
        item.location === null
          ? { label: 'Original location', value: 'unknown', mono: true }
          : this.parent.systemOpenFt.copyable({ label: 'Original location', value: this.locationLabel(item.location), mono: true }, 'copy-trash-location'),
        { label: 'Deleted', value: item.deletedAt === null ? 'unknown' : files.fullTimestamp(item.deletedAt) },
        ...(item.type === 'file' ? [{ label: 'Size', value: `${item.size.toLocaleString('en-US')} bytes (${files.formatBytes(item.size)})` }] : []),
      ];
    }
    const listing = this.state()?.listing;
    if (listing === undefined) {
      return [];
    }
    return [
      { label: 'Kept by', value: listing.trash === 'server' ? 'The server' : 'The system' },
      ...(listing.canList ? [{ label: 'Items', value: this.countLabel() }, { label: 'Size of files', value: files.formatBytes(this.totalBytes()) }] : []),
      { label: 'Restore', value: listing.canRestore ? 'From here' : 'From the system’s file manager' },
    ];
  });

  /** What can be done with the trash — *Empty Trash…* always — or with the entries picked in it. */
  readonly actions = computed<readonly UiActionListItem[]>(() => {
    const listing = this.state()?.listing;
    const actions: UiActionListItem[] = [];
    if (listing?.canRestore === true && this.selectedIn(this.parent.activeGroupId()).length > 0) {
      actions.push({ id: 'restore', label: 'Restore', icon: 'arrow-back-up' });
    }
    actions.push({ id: 'empty', label: `Empty ${this.label()}…`, icon: 'trash' });
    actions.push({ id: 'refresh', label: `Refresh`, icon: 'refresh' });
    return actions;
  });

  runAction(id: string): void {
    this.runToolbarAction(this.parent.activeGroupId(), id);
  }

  /**
   * A value of the Properties list pressed: the picked item's original
   * location, copied (PRD 001, §9.3.1) — the server's is in the root, so its
   * full path is copied as *Copy Path* does; the system's is a host path already.
   */
  runProperty(activation: UiPropertyActivation): void {
    const location = this.picked()?.location;
    if (activation.id !== 'copy-trash-location' || location == null) {
      return;
    }
    const value = this.state()?.listing?.trash === 'server' ? { path: location } : { text: location };
    void this.parent.systemOpenFt.copyPathValue(activation.id, value, activation.shift);
  }

  /* -- internals ---------------------------------------------------------------- */

  private read(): void {
    const current = this.state();
    this.state.set({ status: 'loading', ...(current?.listing ? { listing: current.listing } : {}) });
    this.parent.fileSystem.operationsFt.trashListing().then(
      (listing) => this.state.set({ status: 'ready', listing }),
      (error: unknown) => this.state.set({ status: 'error', ...(current?.listing ? { listing: current.listing } : {}), error: FsError.from(error) }),
    );
  }

  private items(): readonly FsTrashItem[] {
    return this.state()?.listing?.items ?? [];
  }

  /** What a panel has selected, among what is still in the trash. */
  private selectedIn(groupId: string): readonly string[] {
    const ids = new Set(this.items().map((item) => item.id));
    return (this.selections()[groupId]?.selected ?? []).filter((id) => ids.has(id));
  }

  /** The status bar's words while a panel shows the trash: `2 items in the Trash`. */
  readonly summary = computed(() => {
    const listing = this.state()?.listing;
    if (listing === undefined || !listing.canList) {
      return this.label();
    }
    const count = listing.items.length;
    return count === 0 ? `The ${this.label()} is empty` : `${count} ${count === 1 ? 'item' : 'items'} in the ${this.label()}`;
  });

  private countLabel(): string {
    const count = this.items().length;
    return count === 0 ? 'Empty' : `${count} ${count === 1 ? 'item' : 'items'}`;
  }

  private totalBytes(): number {
    return this.items().reduce((total, item) => total + item.size, 0);
  }

  /** A server trash's location is root-relative: shown from `/`, like every path in the app. */
  private locationLabel(location: string): string {
    return this.state()?.listing?.trash === 'server' ? shownPath(location) : location;
  }

  private toViewModel(group: PanelGroupState, active: boolean): UiFileBrowserModel {
    const state = this.state();
    const listing = state?.listing;
    const selection = this.selections()[group.id] ?? { selected: [] };
    const files = this.parent.fileViewModel;
    const rows = this.items().map((item): UiFileRow => {
      const entry = TrashFeature.asEntry(item);
      const selected = selection.selected.includes(item.id);
      return {
        id: item.id,
        name: item.name,
        icon: files.icon(entry),
        tint: files.tint(entry),
        cells: {
          location: item.location === null ? '' : this.locationLabel(item.location),
          deleted: item.deletedAt === null ? '' : files.modifiedLabel({ modifiedAt: item.deletedAt }),
          size: item.type === 'file' ? files.formatBytes(item.size) : '',
        },
        ...(selected && active ? { selected: true } : {}),
        ...(selected && !active ? { inactiveSelected: true } : {}),
        ...(active && selection.focused === item.id ? { focused: true } : {}),
      };
    });
    const canRestore = listing?.canRestore === true && selection.selected.length > 0;
    const toolbar: UiIconAction[] = [
      { id: 'refresh', label: 'Read the trash again', icon: 'refresh' },
      ...(listing?.canRestore === true ? [{ id: 'restore', label: 'Restore the selected items', icon: 'arrow-back-up' as const, ...(canRestore ? {} : { disabled: true }) }] : []),
      { id: 'empty', label: `Empty ${this.label()}…`, icon: 'trash' },
    ];
    return {
      breadcrumbs: [{ id: 'trash', label: this.label(), icon: 'trash' }],
      view: 'list',
      toolbarActions: toolbar,
      columns: COLUMNS,
      rows,
      items: [],
      ...(listing?.canList ? { summary: this.countLabel() } : {}),
      ...this.placeholder(state, rows.length),
    };
  }

  private placeholder(state: TrashState | null, count: number): { empty?: UiEmptyStateModel } {
    if (state?.status === 'error' && state.listing === undefined) {
      return { empty: { icon: 'alert-triangle', title: 'Could not read the trash', hint: state.error?.message ?? 'The server refused the request.' } };
    }
    if (state?.listing !== undefined && !state.listing.canList) {
      return {
        empty: {
          icon: 'trash',
          title: `The ${this.label()} is the system’s`,
          hint: `Your file manager shows what is in it. It can still be emptied from here, with Empty ${this.label()}.`,
        },
      };
    }
    if (state?.listing !== undefined && count === 0) {
      return { empty: { icon: 'trash', title: `The ${this.label()} is empty` } };
    }
    return {};
  }

  /** A trashed item, as the file view model reads an entry — for its icon, tint and type. */
  private static asEntry(item: FsTrashItem) {
    return { type: item.type, name: item.name, size: item.size, modifiedAt: item.deletedAt ?? '' };
  }
}
