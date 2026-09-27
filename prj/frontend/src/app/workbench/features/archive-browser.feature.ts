import { computed, signal } from '@angular/core';
import type {
  UiBreadcrumb,
  UiEmptyStateModel,
  UiFileBrowserModel,
  UiFileColumn,
  UiFileRow,
  UiIconAction,
  UiSelectionChange,
} from '@tr-file/ui';
import type { FsArchiveEntry, FsArchiveListing } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { PanelContentFeature } from '../panel-content.model';
import { PANEL_CONTENT, type PanelGroupState, type PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

/** Extensions opened as an archive tab rather than handed to an app (PRD 003, §6). */
const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set(['zip', 'jar', 'war', 'apk', 'epub', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

/** Only `.zip` is *browsed* on a double click; the rest are documents that happen to be zips. */
const BROWSED_EXTENSIONS: ReadonlySet<string> = new Set(['zip']);

const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size', width: '90px', align: 'end' },
  { key: 'modified', label: 'Modified', width: '150px' },
];

const TOOLBAR: readonly UiIconAction[] = [
  { id: 'up', label: 'Up one level (Alt+Up)', icon: 'arrow-up' },
  { id: 'refresh', label: 'Read the archive again', icon: 'refresh' },
  { id: 'extract-here', label: 'Extract here', icon: 'archive' },
  { id: 'extract-to', label: 'Extract to…', icon: 'folder-open' },
];

interface ArchiveState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly listing?: FsArchiveListing;
  readonly error?: FsError;
}

/** What a panel has selected inside an archive. */
interface ArchiveSelection {
  readonly selected: readonly string[];
  readonly focused?: string;
}

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Browsing inside a zip (PRD 003, §6): a panel tab of its own kind
 * (`archive`), listing one folder of the archive at a time as the file list
 * does — read-only — with *Extract Here* and *Extract To…* on its toolbar.
 *
 * The tab keeps the archive's path and the folder inside it (`inner`); each
 * folder is read from the backend (`/api/archive/list`) when it is shown, and
 * kept by archive and folder. Like every content feature it renders its own
 * `UiFileBrowserModel` and changes groups only through `EditorGroupsFeature`.
 * A reload keeps what is on screen until the new answer lands.
 */
export class ArchiveBrowserFeature implements PanelContentFeature {
  private readonly states = signal<Readonly<Record<string, ArchiveState>>>({});
  private readonly selections = signal<Readonly<Record<string, ArchiveSelection>>>({});

  constructor(private readonly parent: WorkbenchService) {}

  /** Whether a file is an archive the app can look into. */
  isArchive(path: string): boolean {
    return ARCHIVE_EXTENSIONS.has(extensionOf(path));
  }

  /** Whether opening a file browses it — a `.zip` — rather than handing it to an app. */
  browses(path: string): boolean {
    return BROWSED_EXTENSIONS.has(extensionOf(path));
  }

  /* -- panel content --------------------------------------------------------- */

  load(tab: PanelTabState): void {
    this.read(tab.path, tab.inner ?? '');
  }

  isLoading(_group: PanelGroupState, tab: PanelTabState): boolean {
    const state = this.stateOf(tab.path, tab.inner ?? '');
    return state?.status === 'loading' && state.listing === undefined;
  }

  acceptsFiles(): boolean {
    return false;
  }

  /* -- opening ----------------------------------------------------------------- */

  /** Opens an archive in a tab of the group, or goes back to the tab that has it. */
  open(groupId: string, path: string): void {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    if (group === undefined) {
      return;
    }
    const existing = group.tabs.find((tab) => tab.kind === 'archive' && tab.path === path);
    const tab: PanelTabState = existing ?? {
      id: `tab-zip-${groups.createId()}`,
      label: path.slice(path.lastIndexOf('/') + 1),
      path,
      kind: 'archive',
      inner: '',
    };
    groups.setTabs(groupId, existing ? group.tabs : [...group.tabs, tab], tab.id);
    groups.focus(groupId);
    this.load(tab);
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /* -- the view ---------------------------------------------------------------- */

  readonly browsersById = computed<Readonly<Record<string, UiFileBrowserModel>>>(() => {
    const groups = this.parent.editorGroupsFt;
    const active = this.parent.activeGroupId();
    const entries = groups.states().flatMap((group) => {
      const tab = groups.activeTabOf(group);
      return tab && PANEL_CONTENT[tab.kind] === 'archive' ? [[group.id, this.toViewModel(group, tab, group.id === active)] as const] : [];
    });
    return Object.fromEntries(entries);
  });

  browser(groupId: string): UiFileBrowserModel | undefined {
    return this.browsersById()[groupId];
  }

  /** A double click or `Enter`: into a folder of the archive. A file only gets selected — extract it to open it. */
  openEntry(groupId: string, id: string): void {
    const tab = this.tabOf(groupId);
    const entry = tab === undefined ? undefined : this.entriesOf(tab).find((candidate) => candidate.path === id);
    if (tab === undefined || entry === undefined) {
      return;
    }
    if (entry.type === 'directory') {
      this.goTo(groupId, tab, entry.path);
    } else {
      this.setSelection(groupId, { selected: [id], focused: id });
    }
  }

  setSelection(groupId: string, change: UiSelectionChange): void {
    this.selections.update((all) => ({
      ...all,
      [groupId]: { selected: change.selected, ...(change.focused === undefined || change.focused === null ? {} : { focused: change.focused }) },
    }));
  }

  runToolbarAction(groupId: string, actionId: string): void {
    const tab = this.tabOf(groupId);
    if (tab === undefined) {
      return;
    }
    switch (actionId) {
      case 'up':
        this.up(groupId);
        break;
      case 'refresh':
        this.read(tab.path, tab.inner ?? '', true);
        break;
      case 'extract-here':
        void this.parent.operationsFt.extract(tab.path, parentOf(tab.path));
        break;
      case 'extract-to':
        void this.parent.operationsFt.extract(tab.path);
        break;
      default:
        break;
    }
  }

  /** Up a folder inside the archive; from its top, to the folder the archive is in. */
  up(groupId: string): void {
    const tab = this.tabOf(groupId);
    if (tab === undefined) {
      return;
    }
    const inner = tab.inner ?? '';
    if (inner === '') {
      const folder = parentOf(tab.path);
      this.parent.fileBrowserFt.navigateTo(groupId, folder, this.labelFor(folder));
      this.parent.fileBrowserFt.selectEntry(groupId, tab.path);
    } else {
      this.goTo(groupId, tab, parentOf(inner));
    }
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** A crumb: a folder on the disk (`folder:…`) leaves the archive; one inside it (`inner:…`) stays. */
  openBreadcrumb(groupId: string, crumbId: string): void {
    const tab = this.tabOf(groupId);
    if (tab === undefined) {
      return;
    }
    if (crumbId.startsWith('inner:')) {
      this.goTo(groupId, tab, crumbId.slice('inner:'.length));
      return;
    }
    const folder = crumbId === 'root' ? '' : crumbId.slice('folder:'.length);
    this.parent.fileBrowserFt.navigateTo(groupId, folder, this.labelFor(folder));
  }

  /** The keys a panel reports, as far as an archive has a meaning for them. */
  runKey(groupId: string, command: string, entryId: string | null): void {
    switch (command) {
      case 'open':
        if (entryId !== null) {
          this.openEntry(groupId, entryId);
        }
        break;
      case 'up':
        this.up(groupId);
        break;
      case 'refresh':
        this.runToolbarAction(groupId, 'refresh');
        break;
      default:
        break;
    }
  }

  /* -- internals ---------------------------------------------------------------- */

  private goTo(groupId: string, tab: PanelTabState, inner: string): void {
    this.parent.editorGroupsFt.update(groupId, (group) => ({
      ...group,
      tabs: group.tabs.map((candidate) => (candidate.id === tab.id ? { ...candidate, inner } : candidate)),
    }));
    this.selections.update((all) => ({ ...all, [groupId]: { selected: [] } }));
    this.read(tab.path, inner);
  }

  private read(path: string, inner: string, again = false): void {
    const key = ArchiveBrowserFeature.key(path, inner);
    const current = this.states()[key];
    if (current !== undefined && !again && current.status !== 'error') {
      return;
    }
    this.patch(key, { status: 'loading', ...(current?.listing ? { listing: current.listing } : {}) });
    this.parent.fileSystem.readFt.archive(path, inner).then(
      (listing) => this.patch(key, { status: 'ready', listing }),
      (error: unknown) => this.patch(key, { status: 'error', error: FsError.from(error) }),
    );
  }

  private patch(key: string, state: ArchiveState): void {
    this.states.update((all) => ({ ...all, [key]: state }));
  }

  private stateOf(path: string, inner: string): ArchiveState | undefined {
    return this.states()[ArchiveBrowserFeature.key(path, inner)];
  }

  private entriesOf(tab: PanelTabState): readonly FsArchiveEntry[] {
    return this.stateOf(tab.path, tab.inner ?? '')?.listing?.entries ?? [];
  }

  private tabOf(groupId: string): PanelTabState | undefined {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    const tab = group === undefined ? undefined : groups.activeTabOf(group);
    return tab?.kind === 'archive' ? tab : undefined;
  }

  private toViewModel(group: PanelGroupState, tab: PanelTabState, active: boolean): UiFileBrowserModel {
    const inner = tab.inner ?? '';
    const state = this.stateOf(tab.path, inner);
    const entries = state?.listing?.entries ?? [];
    const selection = this.selections()[group.id] ?? { selected: [] };
    const files = this.parent.fileViewModel;
    const rows = entries.map((entry): UiFileRow => {
      const asEntry = { type: entry.type, name: entry.name, size: entry.size, modifiedAt: entry.modifiedAt ?? '' };
      const selected = selection.selected.includes(entry.path);
      return {
        id: entry.path,
        name: entry.name,
        icon: files.icon(asEntry),
        tint: files.tint(asEntry),
        cells: {
          size: entry.type === 'directory' ? '' : files.formatBytes(entry.size),
          modified: entry.modifiedAt === null ? '' : files.modifiedLabel({ modifiedAt: entry.modifiedAt }),
        },
        ...(selected && active ? { selected: true } : {}),
        ...(selected && !active ? { inactiveSelected: true } : {}),
        ...(active && selection.focused === entry.path ? { focused: true } : {}),
      };
    });
    const unsafe = state?.listing?.unsafe ?? 0;
    return {
      breadcrumbs: this.breadcrumbs(tab.path, inner),
      view: 'list',
      toolbarActions: TOOLBAR,
      columns: COLUMNS,
      rows,
      items: [],
      ...(state?.listing
        ? {
            summary: `${entries.length} ${entries.length === 1 ? 'item' : 'items'}${unsafe > 0 ? ` · ${unsafe} unsafe left out` : ''}`,
          }
        : {}),
      ...this.placeholder(state, entries.length),
    };
  }

  private placeholder(state: ArchiveState | undefined, count: number): { empty?: UiEmptyStateModel } {
    if (state?.status === 'error' && state.listing === undefined) {
      return {
        empty: {
          icon: 'alert-triangle',
          title: 'Could not open this archive',
          hint: state.error?.message ?? 'The server refused the request.',
        },
      };
    }
    if (state?.listing && count === 0) {
      return { empty: { icon: 'archive', title: 'This folder of the archive is empty' } };
    }
    return {};
  }

  /** The folders to the archive, the archive, then the folders inside it. */
  private breadcrumbs(path: string, inner: string): readonly UiBreadcrumb[] {
    const folders = parentOf(path).split('/').filter(Boolean);
    const inside = inner.split('/').filter(Boolean);
    return [
      { id: 'root', label: this.parent.placesFt.rootLabel(), icon: 'desktop' },
      ...folders.map((label, index) => ({ id: `folder:${folders.slice(0, index + 1).join('/')}`, label })),
      { id: 'inner:', label: path.slice(path.lastIndexOf('/') + 1), icon: 'archive' },
      ...inside.map((label, index) => ({ id: `inner:${inside.slice(0, index + 1).join('/')}`, label })),
    ];
  }

  private labelFor(path: string): string {
    return path === '' ? this.parent.placesFt.rootLabel() : (path.split('/').at(-1) ?? path);
  }

  private static key(path: string, inner: string): string {
    return `${path}\n${inner}`;
  }
}
