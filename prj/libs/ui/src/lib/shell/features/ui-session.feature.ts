import { effect, signal, untracked } from '@angular/core';
import type { UiGridNode } from '../../models/panel.model';
import type { UiSettingsStore } from '../../settings/ui-settings-store';
import type { UiGroupState, UiTabState } from '../ui-editor.model';
import type { UiWorkbenchConfig, UiWorkbenchLayout } from '../ui-workbench.config';
import type { UiWorkbenchService } from '../ui-workbench.service';

/** A layout is written this long after it last changed — a sash drag is one write, not sixty. */
const SAVE_DELAY_MS = 400;

/** Everything a session remembers (PRD 003, §6). */
export interface UiSessionSnapshot<TGroup extends UiGroupState = UiGroupState> extends UiWorkbenchLayout<TGroup> {
  readonly version: 1;
  /** Open or collapsed; not the tab, which is the default on every start (PRD 001, §12.2). */
  readonly bottomPanel: { readonly collapsed: boolean };
  /** The sidebar panes that were open. */
  readonly panes: readonly string[];
  /** The order of the sidebars' panes (PRD 002, §5.1), where it is not the default. */
  readonly paneOrder: Readonly<Record<string, readonly string[]>>;
  /** The sidebars' panes' heights, as weights (PRD 002, §5.2); only those that were resized. */
  readonly paneSizes: Readonly<Record<string, number>>;
  /** The sidebars' panes hidden from their `…` menus (PRD 001, §9.2). */
  readonly hiddenPanes: readonly string[];
  /** The sidebars the title bar hid. */
  readonly hiddenSidebars: readonly string[];
  /** The application's own fields (`UiWorkbenchConfig.readSession`), written beside the rest. */
  readonly extras: Readonly<Record<string, unknown>>;
}

/** The store key of the last session of `scope`. */
export function uiSessionKey(prefix: string, scope: string): string {
  return `${prefix}.session.v1:${scope}`;
}

/** The store key of whether a session is restored at all. */
export function uiRestoreSessionKey(prefix: string): string {
  return `${prefix}.restore-session.v1`;
}

/**
 * The session, remembered (PRD 003, §6): the panel layout and every panel's
 * tabs, the active panel, the sidebars' widths, which of their panes are open
 * or hidden, in what order and how tall, the bottom panel — and whatever the
 * application adds (`extras`).
 *
 * Kept in the settings per scope (`UiWorkbenchConfig.sessionScope`) and
 * written a moment after each change. Restored when the workbench is made
 * (`restore`, before any feature reads its layout), so the first frame is the
 * last session's rather than a default the app then rearranges. A snapshot
 * that does not hold together — a grid naming a panel that is not there, a
 * tab of a kind this version does not know — is ignored, and the session
 * starts fresh.
 */
export class UiSessionFeature<TTab extends UiTabState = UiTabState, TGroup extends UiGroupState<TTab> = UiGroupState<TTab>> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  /** Whether sessions are restored, as the store says; the settings window's switch. */
  private readonly restoring: ReturnType<typeof signal<boolean>>;

  constructor(protected readonly parent: UiWorkbenchService<TTab, TGroup>) {
    this.restoring = signal(UiSessionFeature.restores(parent.settings, parent.storagePrefix));
    effect(() => {
      const snapshot = this.snapshot();
      if (!this.started) {
        return;
      }
      untracked(() => this.schedule(snapshot));
    });
  }

  /** Whether sessions are restored. */
  static restores(store: UiSettingsStore, prefix: string): boolean {
    return store.get<boolean>(uiRestoreSessionKey(prefix)) !== false;
  }

  /** The last session of its scope, if there is one worth restoring. */
  static restore<TTab extends UiTabState, TGroup extends UiGroupState<TTab>>(
    store: UiSettingsStore,
    prefix: string,
    config: UiWorkbenchConfig<TTab, TGroup>,
  ): UiSessionSnapshot<TGroup> | null {
    if (!UiSessionFeature.restores(store, prefix)) {
      return null;
    }
    return UiSessionFeature.check(store.get<unknown>(uiSessionKey(prefix, config.sessionScope?.() ?? 'local')), config);
  }

  /** Starts remembering; called once the restored layout is up, so the start itself is not a change. */
  start(): void {
    this.started = true;
  }

  /** Whether sessions are restored — the settings window's switch. */
  readonly restoresSessions = (): boolean => this.restoring();

  /** The switch: restore the layout next time, or start fresh. */
  setRestoresSessions(on: boolean): void {
    this.parent.settings.set(uiRestoreSessionKey(this.parent.storagePrefix), on);
    this.restoring.set(on);
  }

  /**
   * *Reset Layout* (PRD 001, §15.1.1): asks first, since the panels, their
   * tabs, the sidebars and the panes all go back to the default and the
   * window starts over.
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
    this.parent.settings.set(this.key, null);
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

  /** `value` as a snapshot of this workbench, or `null` when it does not hold together. */
  validate(value: unknown): UiSessionSnapshot<TGroup> | null {
    return UiSessionFeature.check(value, this.parent.config);
  }

  private get key(): string {
    return uiSessionKey(this.parent.storagePrefix, this.parent.config.sessionScope?.() ?? 'local');
  }

  /** The application's own fields of the session, written beside the rest. */
  protected extras(): Readonly<Record<string, unknown>> {
    return {};
  }

  /** What is on screen now, as it would be restored. */
  private snapshot(): UiSessionSnapshot<TGroup> {
    const p = this.parent;
    const write = p.config.editor.writeGroup;
    const groups = p.editorGroupsFt.states().map((group): TGroup => {
      // What a tab remembers (PRD 001, Fix 4), and the tab it was opened from (PRD 002, §2.5.1), last the session, not beyond it.
      const plain = { ...group, tabs: group.tabs.map(({ remembered: _remembered, openedFrom: _openedFrom, ...tab }) => tab as unknown as TTab) };
      return write === undefined ? plain : write(plain);
    });
    return {
      version: 1,
      grid: p.panelLayoutFt.grid(),
      groups,
      activeGroupId: p.activeGroupId(),
      leftSidebarWidth: p.leftSidebarWidth(),
      rightSidebarWidth: p.rightSidebarWidth(),
      bottomPanelHeight: p.bottomPanelHeight(),
      bottomPanel: { collapsed: p.bottomPanelFt.collapsed() },
      panes: p.sidebarPanesFt.expandedIds(),
      paneOrder: p.sidebarPanesFt.changedOrders(),
      paneSizes: p.sidebarPanesFt.paneSizes(),
      hiddenPanes: p.sidebarPanesFt.hiddenIds(),
      hiddenSidebars: p.chromeFt.hiddenSidebars(),
      extras: this.extras(),
    };
  }

  private schedule(snapshot: UiSessionSnapshot<TGroup>): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write(snapshot);
    }, SAVE_DELAY_MS);
  }

  private write(snapshot: UiSessionSnapshot<TGroup>): void {
    const { extras, ...core } = snapshot;
    this.parent.settings.set(this.key, { ...extras, ...core });
  }

  /* -- checking a snapshot -------------------------------------------------- */

  /** `value` as a snapshot, or `null` when any part of it does not hold together. */
  static check<TTab extends UiTabState, TGroup extends UiGroupState<TTab>>(value: unknown, config: UiWorkbenchConfig<TTab, TGroup>): UiSessionSnapshot<TGroup> | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    if (raw['version'] !== 1 || !Array.isArray(raw['groups']) || raw['groups'].length === 0) {
      return null;
    }
    const groups = raw['groups'].map((group) => UiSessionFeature.group(group, config));
    if (groups.some((group) => group === null)) {
      return null;
    }
    const valid = groups as TGroup[];
    const ids = new Set(valid.map((group) => group.id));
    if (ids.size !== valid.length) {
      return null;
    }
    const leaves: string[] = [];
    if (!UiSessionFeature.grid(raw['grid'], leaves) || leaves.length !== ids.size || leaves.some((id) => !ids.has(id))) {
      return null;
    }
    const activeGroupId = typeof raw['activeGroupId'] === 'string' && ids.has(raw['activeGroupId']) ? raw['activeGroupId'] : (valid[0] as TGroup).id;
    const bottom = (typeof raw['bottomPanel'] === 'object' && raw['bottomPanel'] !== null ? raw['bottomPanel'] : {}) as Record<string, unknown>;
    const width = (key: string, fallback: number): number => {
      const number = raw[key];
      return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const sidebars = config.sidebars.map((sidebar) => sidebar.id);
    return {
      version: 1,
      grid: raw['grid'] as UiGridNode,
      groups: valid,
      activeGroupId,
      leftSidebarWidth: width('leftSidebarWidth', config.layout.leftSidebarWidth),
      rightSidebarWidth: width('rightSidebarWidth', config.layout.rightSidebarWidth),
      bottomPanelHeight: width('bottomPanelHeight', config.layout.bottomPanelHeight),
      // A `tab` saved before §12.2 is ignored.
      bottomPanel: { collapsed: bottom['collapsed'] !== false },
      panes: UiSessionFeature.strings(raw['panes']),
      paneOrder: UiSessionFeature.paneOrder(raw['paneOrder'], sidebars),
      paneSizes: UiSessionFeature.paneSizes(raw['paneSizes']),
      hiddenSidebars: UiSessionFeature.strings(raw['hiddenSidebars']).filter((name) => sidebars.includes(name)),
      // A session from before §9.2 hid nothing on purpose: it gets the default.
      hiddenPanes: Array.isArray(raw['hiddenPanes'])
        ? UiSessionFeature.strings(raw['hiddenPanes'])
        : config.sidebars.flatMap((sidebar) => sidebar.panes.filter((pane) => pane.hidden === true).map((pane) => pane.id)),
      extras: config.readSession?.(raw) ?? {},
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

  /** Only what is a list of names is kept; `UiSidebarPanesFeature` sorts out which names still exist. */
  private static paneOrder(value: unknown, sidebars: readonly string[]): Record<string, readonly string[]> {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    return Object.fromEntries(sidebars.filter((sidebar) => Array.isArray(raw[sidebar])).map((sidebar) => [sidebar, UiSessionFeature.strings(raw[sidebar])]));
  }

  private static group<TTab extends UiTabState, TGroup extends UiGroupState<TTab>>(value: unknown, config: UiWorkbenchConfig<TTab, TGroup>): TGroup | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    if (typeof raw['id'] !== 'string' || !Array.isArray(raw['tabs'])) {
      return null;
    }
    const tabs = raw['tabs'].map((tab) => UiSessionFeature.tab(tab, config));
    if (tabs.some((tab) => tab === null)) {
      return null;
    }
    const group: UiGroupState<TTab> = { id: raw['id'], tabs: tabs as TTab[] };
    return config.editor.readGroup === undefined ? (group as TGroup) : config.editor.readGroup(raw, group);
  }

  private static tab<TTab extends UiTabState, TGroup extends UiGroupState<TTab>>(value: unknown, config: UiWorkbenchConfig<TTab, TGroup>): TTab | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const kinds = config.editor.contents.flatMap((content) => content.kinds);
    if (typeof raw['id'] !== 'string' || typeof raw['label'] !== 'string' || typeof raw['kind'] !== 'string' || !kinds.includes(raw['kind'])) {
      return null;
    }
    const tab: UiTabState = { id: raw['id'], label: raw['label'], kind: raw['kind'], ...(raw['active'] === true ? { active: true } : {}) };
    return config.editor.readTab === undefined ? (tab as TTab) : config.editor.readTab(raw, tab);
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
      raw['children'].every((child) => UiSessionFeature.grid(child, leaves))
    );
  }
}
