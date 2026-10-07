import { computed, signal } from '@angular/core';
import type {
  UiGridNode,
  UiIconAction,
  UiPanelGroupModel,
  UiTab,
} from '@tr-file/ui';
import type { UiDiskUsageItem, UiDiskUsageModel, UiDiskUsageView } from '@tr-file/file-ui';
import type { FsDiskUsageNode, FsDiskUsageScan } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { shownPath } from '../../file-system/fs-path';
import type { WorkbenchService } from '../workbench.service';
import { UiPanelLayout } from '@tr-file/ui';

/** How often a running scan is asked how far it has got (PRD 013, §1). */
export const DISK_USAGE_POLL_MS = 3000;

/** The levels a panel draws to start with, and at most — the backend reports no deeper. */
export const DISK_USAGE_DEFAULT_DEPTH = 2;
export const DISK_USAGE_MAX_SHOWN_DEPTH = 8;

/** A tab of a Disk Usage panel: a folder, drawn one way, to some depth, from one scan. */
export interface DiskUsageTab {
  readonly id: string;
  /** The folder shown, root-relative. */
  readonly path: string;
  readonly view: UiDiskUsageView;
  readonly depth: number;
  /** The scan it is drawn from — one of its folders, or the folder it was started on. */
  readonly scanId: string | null;
}

export interface DiskUsageGroup {
  readonly id: string;
  readonly tabs: readonly DiskUsageTab[];
  readonly activeTabId: string | null;
}

/** What a tab was last answered: the tree under its folder, or why there is none. */
interface DiskUsageReport {
  readonly scanId: string;
  readonly path: string;
  readonly depth: number;
  readonly tree: FsDiskUsageNode | null;
}

const FIRST_GROUP = 'du-1';

/**
 * The Disk Usage sub-application (PRD 013): its own workbench of panels —
 * split, tabbed and resized like the file manager's, with a layout of its own
 * — each tab showing what takes up the space in a folder (`UiDiskUsage`).
 *
 * The space is worked out by scans on the backend (§1), each started on a
 * folder and asked every `DISK_USAGE_POLL_MS` how far it has got — with the
 * folder and depth the tab shows, which is all that comes back. Going into a
 * folder of a scan, or back up to it, asks the same scan; a folder outside
 * every scan of this window starts a new one, as *Rescan* does. A scan no tab
 * shows any more is stopped.
 */
export class DiskUsageFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /** The panels' layout, apart from the file manager's. */
  readonly layout = new UiPanelLayout({ kind: 'leaf', groupId: FIRST_GROUP, size: 1 } satisfies UiGridNode);

  private readonly groups = signal<Readonly<Record<string, DiskUsageGroup>>>({
    [FIRST_GROUP]: { id: FIRST_GROUP, tabs: [], activeTabId: null },
  });

  readonly activeGroupId = signal(FIRST_GROUP);

  /** Every scan of this window, as last heard of. */
  private readonly scans = signal<Readonly<Record<string, FsDiskUsageScan>>>({});

  /** What each tab was last answered. */
  private readonly reports = signal<Readonly<Record<string, DiskUsageReport>>>({});

  /** Why a tab has nothing to draw — its scan could not be started — by tab. */
  private readonly failures = signal<Readonly<Record<string, string>>>({});

  /** Body focus requests, by group; see `PanelFocusFeature`. */
  private readonly focusTokens = signal<Readonly<Record<string, number>>>({});

  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** The folder the active tab shows, or `null` with none. */
  readonly folder = computed(() => {
    const group = this.groups()[this.activeGroupId()];
    return group === undefined ? null : (this.activeTab(group)?.path ?? null);
  });

  stateOf(groupId: string): DiskUsageGroup | undefined {
    return this.groups()[groupId];
  }

  tabState(tabId: string): DiskUsageTab | undefined {
    return Object.values(this.groups())
      .flatMap((group) => group.tabs)
      .find((tab) => tab.id === tabId);
  }

  /* -- opening ------------------------------------------------------------ */

  /**
   * Shows Disk Usage on the folder `path` (PRD 001, §9.3.2): the tab already
   * showing it, else a new one in the active panel.
   */
  open(path: string): void {
    const existing = Object.values(this.groups()).find((group) => group.tabs.some((tab) => tab.path === path));
    const groupId = existing?.id ?? this.activeGroupId();
    const tab = existing?.tabs.find((candidate) => candidate.path === path);
    if (tab !== undefined) {
      this.selectTab(groupId, tab.id);
    } else {
      this.addTab(groupId, path);
    }
    // After the tab: shown with nothing open, it would start on the file manager's folder.
    this.parent.subAppsFt.show('disk-usage');
    this.focusBody(groupId);
  }

  /**
   * The sub-application was brought forward. With nothing open yet it starts
   * on the folder the file manager's active panel shows, so the first look
   * is at what was being looked at.
   */
  shown(): void {
    if (Object.values(this.groups()).some((group) => group.tabs.length > 0)) {
      this.focusBody(this.activeGroupId());
      return;
    }
    const files = this.parent.editorGroupsFt;
    const group = files.stateOf(this.parent.activeGroupId());
    const folder = group !== undefined && files.activeTabOf(group)?.kind === 'folder' ? group.path : '';
    this.addTab(this.activeGroupId(), folder);
    this.focusBody(this.activeGroupId());
  }

  private addTab(groupId: string, path: string, like?: DiskUsageTab): DiskUsageTab {
    const tab: DiskUsageTab = {
      id: `du-tab-${(this.sequence += 1)}`,
      path,
      view: like?.view ?? 'pie',
      depth: like?.depth ?? DISK_USAGE_DEFAULT_DEPTH,
      scanId: like?.scanId ?? null,
    };
    this.updateGroup(groupId, (group) => ({ ...group, tabs: [...group.tabs, tab], activeTabId: tab.id }));
    this.activeGroupId.set(groupId);
    void this.show(tab.id, path);
    return tab;
  }

  /* -- what a tab shows ----------------------------------------------------- */

  /**
   * Shows `path` in a tab: from a scan of this window that covers it when
   * there is one — its own first — else from a new scan started on it.
   */
  async show(tabId: string, path: string): Promise<void> {
    const before = this.tabState(tabId);
    if (before === undefined) {
      return;
    }
    this.updateTab(tabId, (tab) => ({ ...tab, path }));
    this.failures.update(({ [tabId]: _gone, ...rest }) => rest);
    const scan = this.coveringScan(path, before.scanId);
    if (scan === undefined) {
      await this.rescan(tabId);
      return;
    }
    this.updateTab(tabId, (tab) => ({ ...tab, scanId: scan.id }));
    if (before.scanId !== null && before.scanId !== scan.id) {
      this.release(before.scanId);
    }
    await this.fetch(tabId);
    // A folder the scan did not go into — another disk, too deep — is scanned on its own.
    const tree = this.reports()[tabId]?.tree;
    if (tree?.state === 'mount' || tree?.state === 'too-deep') {
      await this.rescan(tabId);
    }
  }

  /** A new scan of the tab's folder, from scratch. */
  async rescan(tabId: string): Promise<void> {
    const tab = this.tabState(tabId);
    if (tab === undefined) {
      return;
    }
    const previous = tab.scanId;
    try {
      const scan = await this.parent.fileSystem.diskUsageFt.start(tab.path, tab.depth);
      this.scans.update((scans) => ({ ...scans, [scan.id]: scan }));
      if (this.tabState(tabId)?.path !== tab.path) {
        return; // Moved on meanwhile; that move asks for what it needs.
      }
      this.updateTab(tabId, (current) => ({ ...current, scanId: scan.id }));
      this.record(tabId, scan);
      this.schedule();
    } catch (error) {
      this.failures.update((all) => ({ ...all, [tabId]: FsError.from(error).message }));
    }
    if (previous !== null) {
      this.release(previous);
    }
  }

  /** Stops the tab's scan where it is; what it found stays. */
  async stop(tabId: string): Promise<void> {
    const scanId = this.tabState(tabId)?.scanId;
    if (scanId === null || scanId === undefined) {
      return;
    }
    try {
      const scan = await this.parent.fileSystem.diskUsageFt.cancel(scanId);
      this.scans.update((scans) => ({ ...scans, [scan.id]: scan }));
    } catch {
      // Gone already: the next look says so.
    }
    await this.fetch(tabId);
  }

  /** Asks the tab's scan for the tree the tab shows. */
  private async fetch(tabId: string): Promise<void> {
    const tab = this.tabState(tabId);
    if (tab === undefined || tab.scanId === null) {
      return;
    }
    try {
      const scan = await this.parent.fileSystem.diskUsageFt.status(tab.scanId, { path: tab.path, depth: tab.depth });
      this.scans.update((scans) => ({ ...scans, [scan.id]: scan }));
      const now = this.tabState(tabId);
      if (now !== undefined && now.scanId === scan.id && now.path === tab.path && now.depth === tab.depth) {
        this.record(tabId, scan);
      }
    } catch (error) {
      const failure = FsError.from(error);
      if (failure.code === 'NOT_FOUND') {
        // The backend has forgotten it (or restarted): scan again.
        this.scans.update(({ [tab.scanId as string]: _gone, ...rest }) => rest);
        await this.rescan(tabId);
      } else {
        this.failures.update((all) => ({ ...all, [tabId]: failure.message }));
      }
    }
  }

  private record(tabId: string, scan: FsDiskUsageScan): void {
    if (scan.report !== undefined) {
      const report = scan.report;
      this.reports.update((all) => ({ ...all, [tabId]: { scanId: scan.id, path: report.path, depth: report.depth, tree: report.tree } }));
    }
  }

  /** A scan of this window whose folder holds `path` — `preferred` if it does — not one stopped short. */
  private coveringScan(path: string, preferred: string | null): FsDiskUsageScan | undefined {
    const covers = (scan: FsDiskUsageScan): boolean =>
      (scan.state === 'running' || scan.state === 'done') && (scan.path === '' || path === scan.path || path.startsWith(`${scan.path}/`));
    const scans = this.scans();
    const own = preferred === null ? undefined : scans[preferred];
    if (own !== undefined && covers(own)) {
      return own;
    }
    // The closest one: the scan started deepest.
    return Object.values(scans)
      .filter(covers)
      .sort((a, b) => b.path.length - a.path.length)[0];
  }

  /** Stops a scan no tab is drawn from any more. */
  private release(scanId: string): void {
    const used = Object.values(this.groups()).some((group) => group.tabs.some((tab) => tab.scanId === scanId));
    if (used) {
      return;
    }
    const scan = this.scans()[scanId];
    if (scan?.state === 'running') {
      void this.parent.fileSystem.diskUsageFt.cancel(scanId).catch(() => undefined);
    }
    this.scans.update(({ [scanId]: _gone, ...rest }) => rest);
  }

  /* -- polling -------------------------------------------------------------- */

  /**
   * Every `DISK_USAGE_POLL_MS` while a scan runs, each tab drawn from a
   * running scan asks it again — never faster, so neither the window nor the
   * channel is flooded.
   */
  private schedule(): void {
    if (this.timer !== null || !this.anyRunning()) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, DISK_USAGE_POLL_MS);
  }

  private anyRunning(): boolean {
    return Object.values(this.scans()).some((scan) => scan.state === 'running');
  }

  /** One round: every tab of a running scan asked once, then the next round, while any runs. */
  async poll(): Promise<void> {
    const scans = this.scans();
    const tabs = Object.values(this.groups())
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.scanId !== null && scans[tab.scanId]?.state === 'running');
    await Promise.all(tabs.map((tab) => this.fetch(tab.id)));
    this.schedule();
  }

  /* -- tabs and panels -------------------------------------------------------- */

  activate(groupId: string): void {
    if (this.groups()[groupId] !== undefined) {
      this.activeGroupId.set(groupId);
    }
  }

  selectTab(groupId: string, tabId: string): void {
    this.updateGroup(groupId, (group) => ({ ...group, activeTabId: tabId }));
    this.activeGroupId.set(groupId);
    // A tab of a scan done long ago may have been forgotten by the backend: asking says so.
    void this.fetch(tabId);
  }

  closeTab(groupId: string, tabId: string): void {
    const group = this.groups()[groupId];
    const closing = group?.tabs.find((tab) => tab.id === tabId);
    if (group === undefined || closing === undefined) {
      return;
    }
    const at = group.tabs.indexOf(closing);
    const tabs = group.tabs.filter((tab) => tab.id !== tabId);
    const groupIds = this.layout.groupIds();
    if (tabs.length === 0 && groupIds.length > 1) {
      // An empty panel beside others goes, as the file manager's does.
      this.groups.update(({ [groupId]: _gone, ...rest }) => rest);
      this.layout.remove(groupId);
      if (this.activeGroupId() === groupId) {
        this.activeGroupId.set(this.layout.groupIds()[0] ?? FIRST_GROUP);
      }
    } else {
      const active = group.activeTabId === tabId ? (tabs[Math.min(at, tabs.length - 1)]?.id ?? null) : group.activeTabId;
      this.updateGroup(groupId, () => ({ ...group, tabs, activeTabId: active }));
    }
    this.reports.update(({ [tabId]: _gone, ...rest }) => rest);
    this.failures.update(({ [tabId]: _gone, ...rest }) => rest);
    if (closing.scanId !== null) {
      this.release(closing.scanId);
    }
  }

  /** A tab bar button, or the key standing for one: split, a new tab, maximize. */
  runAction(groupId: string, actionId: string): void {
    const group = this.groups()[groupId];
    const tab = group === undefined ? undefined : this.activeTab(group);
    switch (actionId) {
      case 'split-right':
      case 'split-down': {
        if (tab === undefined) {
          return;
        }
        const id = `du-${(this.sequence += 1)}`;
        this.groups.update((all) => ({ ...all, [id]: { id, tabs: [], activeTabId: null } }));
        this.layout.insertBeside(groupId, id, actionId === 'split-right' ? 'right' : 'bottom');
        this.addTab(id, tab.path, tab);
        this.focusBody(id);
        break;
      }
      case 'new-tab':
        this.addTab(groupId, tab?.path ?? '', tab);
        this.focusBody(groupId);
        break;
      case 'maximize':
        this.layout.toggleMaximize(groupId);
        break;
      default:
        break;
    }
  }

  focusBody(groupId: string): void {
    this.activate(groupId);
    this.sequence += 1;
    const token = this.sequence;
    this.focusTokens.update((tokens) => ({ ...tokens, [groupId]: token }));
  }

  focusToken(groupId: string): number {
    return this.focusTokens()[groupId] ?? 0;
  }

  /* -- the panel's own controls ----------------------------------------------- */

  runToolbarAction(groupId: string, actionId: string): void {
    const tab = this.activeTabOf(groupId);
    if (tab === undefined) {
      return;
    }
    switch (actionId) {
      case 'up':
        if (tab.path !== '') {
          void this.show(tab.id, DiskUsageFeature.parentOf(tab.path));
        }
        break;
      case 'refresh':
        void this.rescan(tab.id);
        break;
      case 'stop':
        void this.stop(tab.id);
        break;
      default:
        break;
    }
  }

  setView(groupId: string, view: UiDiskUsageView): void {
    const tab = this.activeTabOf(groupId);
    if (tab !== undefined) {
      this.updateTab(tab.id, (current) => ({ ...current, view }));
    }
  }

  setDepth(groupId: string, depth: number): void {
    const tab = this.activeTabOf(groupId);
    if (tab === undefined) {
      return;
    }
    this.updateTab(tab.id, (current) => ({ ...current, depth: Math.min(Math.max(depth, 1), DISK_USAGE_MAX_SHOWN_DEPTH) }));
    void this.fetch(tab.id);
  }

  /** A folder of the drawing was chosen: shown in its place. */
  openEntry(groupId: string, path: string): void {
    const tab = this.activeTabOf(groupId);
    if (tab !== undefined) {
      void this.show(tab.id, path);
    }
  }

  openBreadcrumb(groupId: string, crumbId: string): void {
    this.openEntry(groupId, crumbId === 'root' ? '' : crumbId);
  }

  /** The path bar, typed in: the same suggestions as a file browser's (PRD 004, §4.2). */
  locationInput(groupId: string, text: string): void {
    const tab = this.activeTabOf(groupId);
    if (tab !== undefined) {
      this.parent.fileBrowserFt.locationInput(DiskUsageFeature.locationKey(tab.id), text);
    }
  }

  /** A path typed and submitted: its folder — a file's own folder — is shown. */
  async goToLocation(groupId: string, text: string): Promise<void> {
    const tab = this.activeTabOf(groupId);
    if (tab === undefined) {
      return;
    }
    const location = await this.parent.fileBrowserFt.resolveLocation(DiskUsageFeature.locationKey(tab.id), text);
    if (location !== null) {
      await this.show(tab.id, location.folder);
      this.focusBody(groupId);
    }
  }

  /* -- view models ------------------------------------------------------------ */

  group(groupId: string): UiPanelGroupModel | undefined {
    const group = this.groups()[groupId];
    if (group === undefined) {
      return undefined;
    }
    const maximized = this.layout.isMaximized(groupId);
    return {
      id: group.id,
      tabs: group.tabs.map(
        (tab): UiTab => ({
          id: tab.id,
          label: this.parent.fileBrowserFt.labelFor(tab.path),
          icon: 'database',
          ...(tab.id === group.activeTabId ? { active: true } : {}),
        }),
      ),
      actions: [
        { id: 'split-right', label: 'Split right', icon: 'columns' },
        { id: 'split-down', label: 'Split down', icon: 'rows' },
        { id: 'maximize', label: maximized ? 'Restore group' : 'Maximize group', icon: 'maximize', active: maximized },
      ],
      ...(group.tabs.length === 0
        ? { empty: { icon: 'database', title: 'No folder open', hint: 'Choose a folder’s Size in Details, or press Ctrl+T.' } }
        : {}),
    };
  }

  content(groupId: string): UiDiskUsageModel | undefined {
    const tab = this.activeTabOf(groupId);
    if (tab === undefined) {
      return undefined;
    }
    const scan = tab.scanId === null ? undefined : this.scans()[tab.scanId];
    const report = this.reports()[tab.id];
    // A report of another folder or depth is still drawn while the right one is on its way: no blank frames.
    const tree = report?.tree ?? null;
    const failure = this.failures()[tab.id];
    const running = scan?.state === 'running';
    const files = this.parent.fileBrowserFt;
    const actions: UiIconAction[] = [
      { id: 'up', label: 'Up one level', icon: 'arrow-up', ...(tab.path === '' ? { disabled: true } : {}) },
      { id: 'refresh', label: 'Scan again', icon: 'refresh' },
      // Stops the scan where it is (PRD 013, §2.1.1); its key is the panel's `view.stopLoading`, `Escape`.
      ...(running ? [{ id: 'stop', label: this.stopLabel(), icon: 'player-stop' } as const] : []),
    ];
    return {
      breadcrumbs: files.breadcrumbsOf(tab.path),
      location: shownPath(tab.path),
      locationSuggestions: files.locationSuggestionsFor(DiskUsageFeature.locationKey(tab.id)),
      toolbarActions: actions,
      view: tab.view,
      depth: tab.depth,
      maxDepth: DISK_USAGE_MAX_SHOWN_DEPTH,
      ...DiskUsageFeature.optional('summary', this.summary(scan)),
      root: tree === null ? null : this.item(tree, files.labelFor(report?.path ?? tab.path), '', running),
      ...(failure !== undefined
        ? { empty: { icon: 'alert-triangle', title: 'Could not scan this folder', hint: failure } }
        : tree === null
          ? {
              empty: {
                icon: 'database',
                title: running || scan === undefined ? 'Scanning…' : 'Nothing found here',
                hint: running ? 'The scan has not reached this folder yet.' : 'Scan again to look at it.',
              },
            }
          : {}),
    };
  }

  private summary(scan: FsDiskUsageScan | undefined): string | undefined {
    if (scan === undefined) {
      return undefined;
    }
    const { totals } = scan;
    const files = this.parent.fileViewModel;
    const counted = `${totals.files.toLocaleString('en-US')} files · ${files.formatBytes(totals.size)}`;
    const unreadable = totals.errors > 0 ? ` · ${totals.errors.toLocaleString('en-US')} unreadable` : '';
    const took = DiskUsageFeature.duration(scan.elapsedMs);
    switch (scan.state) {
      case 'running':
        return `Scanning… ${counted}${unreadable} · ${took}`;
      case 'done':
        return `${counted}${unreadable} · scanned in ${took}`;
      case 'cancelled':
        return `Stopped: ${counted} so far`;
      case 'failed':
        return `Scan failed: ${scan.error ?? 'unknown error'}`;
    }
  }

  /** The Stop button's name, with the key that does the same as the user has it bound. */
  private stopLabel(): string {
    const key = this.parent.keybindingsFt.label('view.stopLoading');
    return key === undefined ? 'Stop scanning' : `Stop scanning (${key})`;
  }

  /** `running`: the scan is still going — else a folder not all in was left so by a stop. */
  private item(node: FsDiskUsageNode, name: string, parentId = '', running = true): UiDiskUsageItem {
    const files = this.parent.fileViewModel;
    const id = node.path ?? `${parentId}\u0000rest`;
    const count = (value: number, one: string, many: string): string => `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
    const detail =
      node.kind === 'folder'
        ? `${count(node.files, 'file', 'files')} · ${count(node.folders, 'folder', 'folders')}`
        : node.kind === 'rest'
          ? count(node.count ?? 0, 'entry', 'entries')
          : undefined;
    const note = DiskUsageFeature.noteOf(node, running);
    return {
      id,
      name,
      kind: node.kind,
      size: node.size,
      sizeLabel: files.formatBytes(node.size),
      ...(detail === undefined ? {} : { detail }),
      ...(note === undefined ? {} : { note }),
      ...(node.kind === 'folder' && node.state !== 'unreadable' && node.path !== null ? { openable: true } : {}),
      ...(node.children === undefined ? {} : { children: node.children.map((child) => this.item(child, child.name, id, running)) }),
    };
  }

  private static noteOf(node: FsDiskUsageNode, running: boolean): string | undefined {
    switch (node.state) {
      case 'scanning':
        return running ? 'scanning…' : 'not all scanned';
      case 'unreadable':
        return 'unreadable';
      case 'mount':
        return 'another disk — open it to scan';
      case 'too-deep':
        return 'too deep — open it to scan';
      default:
        return undefined;
    }
  }

  /* -- helpers -------------------------------------------------------------- */

  private activeTab(group: DiskUsageGroup): DiskUsageTab | undefined {
    return group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
  }

  private activeTabOf(groupId: string): DiskUsageTab | undefined {
    const group = this.groups()[groupId];
    return group === undefined ? undefined : this.activeTab(group);
  }

  private updateGroup(groupId: string, change: (group: DiskUsageGroup) => DiskUsageGroup): void {
    this.groups.update((all) => {
      const group = all[groupId];
      return group === undefined ? all : { ...all, [groupId]: change(group) };
    });
  }

  private updateTab(tabId: string, change: (tab: DiskUsageTab) => DiskUsageTab): void {
    this.groups.update((all) => {
      const owner = Object.values(all).find((group) => group.tabs.some((tab) => tab.id === tabId));
      return owner === undefined ? all : { ...all, [owner.id]: { ...owner, tabs: owner.tabs.map((tab) => (tab.id === tabId ? change(tab) : tab)) } };
    });
  }

  private static optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
    return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
  }

  private static locationKey(tabId: string): string {
    return `disk-usage:${tabId}`;
  }

  private static parentOf(path: string): string {
    const at = path.lastIndexOf('/');
    return at === -1 ? '' : path.slice(0, at);
  }

  /** `0:42`, `12:05`, `1:02:05`. */
  private static duration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
}
