import { effect, untracked } from '@angular/core';
import type { UiGridNode, UiPanelView } from '@tr-file/ui';
import type { SettingsStore } from '../../settings/settings.service';
import type { MockWorkbenchLayout } from '../mock-data/mock-data.model';
import type { PanelDiffSpec, PanelGroupState, PanelSort, PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';
import type { SidebarId } from './sidebar-panes.feature';

/** Settings key of the last session's layout; the backend it was on is appended. */
export const SESSION_KEY = 'tr-file.session.v1';

/** Whether a session is restored at all; on unless switched off in the Settings menu. */
export const RESTORE_SESSION_KEY = 'tr-file.restore-session.v1';

/** A layout is written this long after it last changed — a sash drag is one write, not sixty. */
const SAVE_DELAY_MS = 400;

const VIEWS: ReadonlySet<string> = new Set<UiPanelView>(['list', 'grid', 'tree']);
const TAB_KINDS: ReadonlySet<string> = new Set<PanelTabState['kind']>(['folder', 'file', 'archive', 'diff', 'trash']);
const SORT_KEYS: ReadonlySet<string> = new Set<PanelSort['key']>(['name', 'size', 'type', 'modified']);

/** Everything a session remembers (PRD 003, §6). */
export interface SessionSnapshot extends MockWorkbenchLayout {
  readonly version: 1;
  readonly bottomPanel: { readonly tab: string; readonly collapsed: boolean };
  readonly showHidden: boolean;
  /** The sidebar panes that were open. */
  readonly panes: readonly string[];
  /** The order of the sidebars' panes (PRD 002, §5.1), where it is not the default. */
  readonly paneOrder: Partial<Record<SidebarId, readonly string[]>>;
  /** The sidebars' panes' heights, as weights (PRD 002, §5.2); only those that were resized. */
  readonly paneSizes: Readonly<Record<string, number>>;
}

/**
 * The session, remembered (PRD 003, §6): the panel layout and every panel's
 * tabs, folder, view and sort, the active panel, the sidebars' widths,
 * which of their panes are open, in what order and how tall, the bottom panel, and
 * whether hidden files show.
 *
 * Kept in the settings per backend — the folders of this computer are not a
 * remote server's — and written a moment after each change. Restored when
 * the workbench is made (`restore`, before any feature reads its layout), so
 * the first frame is the last session's rather than a default the app then
 * rearranges. A snapshot that does not hold together — a grid naming a panel
 * that is not there, a tab of a kind this version does not know — is
 * ignored, and the session starts fresh.
 *
 * What a panel had selected, its history and its filter are not kept: they
 * are about what someone was doing, not where they were.
 */
export class SessionFeature {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(private readonly parent: WorkbenchService) {
    effect(() => {
      const snapshot = this.snapshot();
      if (!this.started) {
        return;
      }
      untracked(() => this.schedule(snapshot));
    });
  }

  /** The key this backend's session is kept under. */
  static keyFor(scope: string): string {
    return `${SESSION_KEY}:${scope}`;
  }

  /** Whether sessions are restored; the Settings menu switches it. */
  static restores(store: SettingsStore): boolean {
    return store.get<boolean>(RESTORE_SESSION_KEY) !== false;
  }

  /** The last session on this backend, if there is one worth restoring. */
  static restore(store: SettingsStore, scope: string): SessionSnapshot | null {
    if (!SessionFeature.restores(store)) {
      return null;
    }
    return SessionFeature.validate(store.get<unknown>(SessionFeature.keyFor(scope)));
  }

  /** Starts remembering; called once the restored layout is up, so the start itself is not a change. */
  start(): void {
    this.started = true;
  }

  get restoresSessions(): boolean {
    return SessionFeature.restores(this.parent.settings);
  }

  /** The Settings menu's switch: restore the layout next time, or start fresh. */
  setRestoresSessions(on: boolean): void {
    this.parent.settings.set(RESTORE_SESSION_KEY, on);
  }

  /**
   * *Reset Layout* — the title bar's layout button (PRD 001, §15.1.1), the
   * View and Settings menus, the palette: asks first, since the panels, their
   * tabs and folders, the sidebars and the panes all go back to the default
   * and the window starts over.
   */
  async confirmResetLayout(): Promise<void> {
    const sure = await this.parent.modal.confirm({
      severity: 'warning',
      message: 'Reset the layout to its default?',
      detail: 'Panels, tabs, sidebars and panes go back to how a fresh window has them, and the window reloads.',
      confirmLabel: 'Reset Layout',
    });
    if (sure) {
      this.resetLayout();
    }
  }

  /** Forgets the session and starts the window over, fresh. */
  resetLayout(): void {
    this.started = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.parent.settings.set(SessionFeature.keyFor(this.scope), null);
    this.reload();
  }

  /** Starts the window over; a seam, so tests can watch it instead. */
  reload(): void {
    globalThis.location?.reload();
  }

  /** Writes now what is waiting to be written — before the window goes. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.write(untracked(() => this.snapshot()));
    }
  }

  private get scope(): string {
    return this.parent.connection.label() ?? 'local';
  }

  /** What is on screen now, as it would be restored. */
  private snapshot(): SessionSnapshot {
    const p = this.parent;
    const groups = p.editorGroupsFt.states().map(
      (group): PanelGroupState => ({
        id: group.id,
        path: group.path,
        view: group.view,
        // What a tab remembers of its selection (PRD 001, Fix 4) lasts the session, not beyond it.
        tabs: group.tabs.map(({ remembered: _remembered, ...tab }) => tab),
        selection: [],
        ...(group.sort === undefined ? {} : { sort: group.sort }),
      }),
    );
    return {
      version: 1,
      grid: p.panelLayoutFt.grid(),
      groups,
      selectedEntryId: '',
      activeGroupId: p.activeGroupId(),
      leftSidebarWidth: p.leftSidebarWidth(),
      rightSidebarWidth: p.rightSidebarWidth(),
      bottomPanelHeight: p.bottomPanelHeight(),
      bottomPanel: { tab: p.bottomPanelFt.activeTab(), collapsed: p.bottomPanelFt.collapsed() },
      showHidden: p.showHidden(),
      panes: p.sidebarPanesFt.expandedIds(),
      paneOrder: p.sidebarPanesFt.changedOrders(),
      paneSizes: p.sidebarPanesFt.paneSizes(),
    };
  }

  private schedule(snapshot: SessionSnapshot): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write(snapshot);
    }, SAVE_DELAY_MS);
  }

  private write(snapshot: SessionSnapshot): void {
    this.parent.settings.set(SessionFeature.keyFor(this.scope), snapshot);
  }

  /* -- checking a snapshot -------------------------------------------------- */

  /** `value` as a snapshot, or `null` when any part of it does not hold together. */
  static validate(value: unknown): SessionSnapshot | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    if (raw['version'] !== 1 || !Array.isArray(raw['groups']) || raw['groups'].length === 0) {
      return null;
    }
    const groups = raw['groups'].map(SessionFeature.group);
    if (groups.some((group) => group === null)) {
      return null;
    }
    const valid = groups as PanelGroupState[];
    const ids = new Set(valid.map((group) => group.id));
    if (ids.size !== valid.length) {
      return null;
    }
    const leaves: string[] = [];
    if (!SessionFeature.grid(raw['grid'], leaves) || leaves.length !== ids.size || leaves.some((id) => !ids.has(id))) {
      return null;
    }
    const activeGroupId = typeof raw['activeGroupId'] === 'string' && ids.has(raw['activeGroupId']) ? raw['activeGroupId'] : (valid[0] as PanelGroupState).id;
    const bottom = (typeof raw['bottomPanel'] === 'object' && raw['bottomPanel'] !== null ? raw['bottomPanel'] : {}) as Record<string, unknown>;
    const width = (key: string, fallback: number): number => {
      const number = raw[key];
      return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : fallback;
    };
    return {
      version: 1,
      grid: raw['grid'] as UiGridNode,
      groups: valid,
      selectedEntryId: '',
      activeGroupId,
      leftSidebarWidth: width('leftSidebarWidth', 280),
      rightSidebarWidth: width('rightSidebarWidth', 320),
      bottomPanelHeight: width('bottomPanelHeight', 200),
      bottomPanel: {
        tab: typeof bottom['tab'] === 'string' ? bottom['tab'] : 'transfers',
        collapsed: bottom['collapsed'] !== false,
      },
      showHidden: raw['showHidden'] === true,
      panes: SessionFeature.strings(raw['panes']),
      paneOrder: SessionFeature.paneOrder(raw['paneOrder']),
      paneSizes: SessionFeature.paneSizes(raw['paneSizes']),
    };
  }

  private static strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private static paneSizes(value: unknown): Record<string, number> {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0),
    );
  }

  /** Only what is a list of names is kept; `SidebarPanesFeature` sorts out which names still exist. */
  private static paneOrder(value: unknown): Partial<Record<SidebarId, readonly string[]>> {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    return Object.fromEntries(
      (['explorer', 'details'] as const).filter((sidebar) => Array.isArray(raw[sidebar])).map((sidebar) => [sidebar, SessionFeature.strings(raw[sidebar])]),
    );
  }

  private static group(value: unknown): PanelGroupState | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    if (typeof raw['id'] !== 'string' || typeof raw['path'] !== 'string' || typeof raw['view'] !== 'string' || !VIEWS.has(raw['view'])) {
      return null;
    }
    if (!Array.isArray(raw['tabs'])) {
      return null;
    }
    const tabs = raw['tabs'].map(SessionFeature.tab);
    if (tabs.some((tab) => tab === null)) {
      return null;
    }
    const sort = raw['sort'] as Record<string, unknown> | undefined;
    const validSort =
      typeof sort === 'object' && sort !== null && typeof sort['key'] === 'string' && SORT_KEYS.has(sort['key']) && (sort['direction'] === 'asc' || sort['direction'] === 'desc')
        ? { sort: { key: sort['key'] as PanelSort['key'], direction: sort['direction'] as PanelSort['direction'] } }
        : {};
    return {
      id: raw['id'],
      path: raw['path'],
      view: raw['view'] as UiPanelView,
      tabs: tabs as PanelTabState[],
      selection: [],
      ...validSort,
    };
  }

  private static tab(value: unknown): PanelTabState | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const diff = SessionFeature.diff(raw['diff']);
    if (raw['kind'] === 'diff' && diff === null) {
      return null;
    }
    if (
      typeof raw['id'] !== 'string' ||
      typeof raw['label'] !== 'string' ||
      typeof raw['path'] !== 'string' ||
      typeof raw['kind'] !== 'string' ||
      !TAB_KINDS.has(raw['kind'])
    ) {
      return null;
    }
    return {
      id: raw['id'],
      label: raw['label'],
      path: raw['path'],
      kind: raw['kind'] as PanelTabState['kind'],
      ...(raw['active'] === true ? { active: true } : {}),
      ...(typeof raw['inner'] === 'string' ? { inner: raw['inner'] } : {}),
      ...(diff === null ? {} : { diff }),
    };
  }

  /** A diff tab's repository, file and side (PRD 011, §1), or `null` when it is not one. */
  private static diff(value: unknown): PanelDiffSpec | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    return typeof raw['root'] === 'string' && typeof raw['file'] === 'string' && typeof raw['staged'] === 'boolean'
      ? { root: raw['root'], file: raw['file'], staged: raw['staged'] }
      : null;
  }

  /** Whether `value` is a grid node; collects its leaves' group ids. */
  private static grid(value: unknown, leaves: string[]): boolean {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const raw = value as Record<string, unknown>;
    if (raw['size'] !== undefined && (typeof raw['size'] !== 'number' || !Number.isFinite(raw['size']))) {
      return false;
    }
    if (raw['kind'] === 'leaf') {
      if (typeof raw['groupId'] !== 'string') {
        return false;
      }
      leaves.push(raw['groupId']);
      return true;
    }
    return (
      raw['kind'] === 'split' &&
      (raw['direction'] === 'row' || raw['direction'] === 'column') &&
      Array.isArray(raw['children']) &&
      raw['children'].length >= 2 &&
      raw['children'].every((child) => SessionFeature.grid(child, leaves))
    );
  }
}
