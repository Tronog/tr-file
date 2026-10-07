import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type { UiPerfSpan, UiPerformanceModel, UiProcessListModel, UiProcessMenuRequest } from '@tr-file/file-ui';
import type { UiStatusItem } from '@tr-file/ui';
import type { FsProcess, FsProcessesHistory, FsProcessesSnapshot } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import {
  PROCESS_COLUMNS,
  buildProcessRows,
  formatMemory,
  type ProcessColumnId,
  type ProcessGroup,
  type ProcessSort,
} from '../task-manager/process-rows';
import { buildPerformance, type CpuView } from '../task-manager/performance';
import type { WorkbenchService } from '../workbench.service';

/** Task Manager's tabs: the processes, and the machine's graphs (PRD 014, §2.1). */
export type TaskManagerView = 'processes' | 'graph';

/** Where the columns and the order are remembered. */
export const TASK_MANAGER_KEY = 'tr-file.task-manager.v1';

/** How often the list is asked for again: the backend measures every two seconds (PRD 014, §1). */
export const TASK_MANAGER_POLL_MS = 2000;

/** After a failed ask, how long before the next. */
const RETRY_MS = 5000;

interface Remembered {
  readonly columns?: readonly ProcessColumnId[];
  readonly sort?: ProcessSort;
  readonly view?: TaskManagerView;
  readonly span?: UiPerfSpan;
  readonly cpuView?: CpuView;
}

/** What a row of the list stands for: one process, or an executable's group of them. */
type Selected = { readonly kind: 'process'; readonly process: FsProcess } | { readonly kind: 'group'; readonly group: ProcessGroup };

/** The header's menu: a row per column that may be hidden. */
const COLUMN_MENU = PROCESS_COLUMNS.filter((column) => column.id !== 'name').map((column) => `process.column.${column.id}`);

/** A row's menu, Task Manager's. */
const ROW_MENU = ['process.toggleExpand', '-', 'process.endTask', 'process.endTree', '-', 'process.openLocation', 'process.copyDetails'];

/**
 * Task Manager (PRD 014, §2): the backend machine's processes, as Windows
 * 10's Task Manager shows them on its *Processes* tab.
 *
 * The backend measures every two seconds whether anyone looks or not
 * (§1); this asks for its latest sample every two seconds while the
 * sub-application is shown and not paused — never two asks at once — and
 * builds the list from it (`buildProcessRows`) — and, while the Graph tab is
 * shown (§2.1), the machine's last ten minutes too (`buildPerformance`).
 * Paused, the list stands still,
 * as Task Manager's *Update speed › Paused* keeps it.
 *
 * What the user chose — the columns, the order — is kept in the settings; a
 * group opened, the row selected and the filter are the window's alone.
 * *End task* and the rest are commands of the table, so the row's menu, the
 * palette and the keys run the same.
 */
export class TaskManagerFeature {
  private readonly snapshot = signal<FsProcessesSnapshot | null>(null);
  private readonly failure = signal<string | null>(null);
  readonly paused = signal(false);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  private readonly selectedId = signal<string | null>(null);
  readonly filter = signal('');
  private readonly columns = signal<readonly ProcessColumnId[]>(PROCESS_COLUMNS.filter((column) => column.shown).map((column) => column.id));
  private readonly sortBy = signal<ProcessSort>({ column: 'name', direction: 'asc' });

  /** Which tab is shown. */
  readonly view = signal<TaskManagerView>('processes');
  /** The Graph's resource chosen, its span, and how the CPU is drawn. */
  private readonly perfSelected = signal<string | null>('cpu');
  private readonly span = signal<UiPerfSpan>('60s');
  private readonly cpuView = signal<CpuView>('overall');
  /** The machine's last ten minutes, asked for while the Graph is shown. */
  private readonly history = signal<FsProcessesHistory | null>(null);

  /** Bumped to put the keyboard on the list, and in the filter box. */
  readonly focusToken = signal(0);
  readonly filterFocus = signal(0);

  private readonly running = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private asking = false;
  /** Processes being ended, so a second press does not end them twice. */
  private ending = false;

  constructor(private readonly parent: WorkbenchService) {
    const remembered = parent.settings.get<Remembered>(TASK_MANAGER_KEY);
    const known = new Set(PROCESS_COLUMNS.map((column) => column.id));
    if (remembered?.columns !== undefined) {
      this.columns.set(remembered.columns.filter((id) => known.has(id)));
    }
    if (remembered?.sort !== undefined && known.has(remembered.sort.column)) {
      this.sortBy.set(remembered.sort);
    }
    if (remembered?.view === 'graph' || remembered?.view === 'processes') {
      this.view.set(remembered.view);
    }
    if (remembered?.span === '60s' || remembered?.span === '10m') {
      this.span.set(remembered.span);
    }
    if (remembered?.cpuView === 'overall' || remembered?.cpuView === 'logical') {
      this.cpuView.set(remembered.cpuView);
    }

    // Asked while shown and not paused; nothing otherwise — the backend keeps measuring either way.
    effect(() => {
      const wanted = this.running() && this.parent.subAppsFt.isActive('task-manager') && !this.paused();
      untracked(() => (wanted ? this.poll() : this.stopPolling()));
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts following the sub-application; the workbench component calls it, so a service built for a test asks nothing. */
  start(): void {
    this.running.set(true);
  }

  stop(): void {
    this.running.set(false);
    this.stopPolling();
  }

  /** The sub-application was shown: the keyboard goes to the list. */
  shown(): void {
    this.focusToken.update((token) => token + 1);
  }

  /** Shows a tab; the Graph asks for its history at once rather than at the next interval. */
  setView(view: TaskManagerView): void {
    if (this.view() === view) {
      return;
    }
    this.view.set(view);
    this.remember();
    this.focusToken.update((token) => token + 1);
    if (view === 'graph') {
      this.refresh();
    }
  }

  selectResource(id: string): void {
    this.perfSelected.set(id);
  }

  setSpan(span: UiPerfSpan): void {
    this.span.set(span);
    this.remember();
  }

  setCpuView(view: string): void {
    if (view === 'overall' || view === 'logical') {
      this.cpuView.set(view);
      this.remember();
    }
  }

  /** The Graph tab (PRD 014, §2.1). */
  readonly performance = computed<UiPerformanceModel>(() => {
    const snapshot = this.snapshot();
    const failure = this.failure();
    const empty = { resources: [], selectedId: null, page: null, span: this.span(), spanLabel: '' };
    if (snapshot === null || !snapshot.available) {
      return {
        ...empty,
        empty:
          snapshot !== null
            ? { icon: 'lock', title: 'Task Manager is not available here', ...(snapshot.reason === null ? {} : { hint: snapshot.reason }) }
            : failure !== null
              ? { icon: 'alert-triangle', title: 'Could not read the processes', hint: failure }
              : { icon: 'activity', title: 'Measuring the machine…' },
      };
    }
    return buildPerformance({ snapshot, history: this.history(), selectedId: this.perfSelected(), span: this.span(), cpuView: this.cpuView() });
  });

  /* -- what is drawn --------------------------------------------------------- */

  private readonly built = computed(() => {
    const snapshot = this.snapshot();
    if (snapshot === null || !snapshot.available) {
      return null;
    }
    return buildProcessRows({ snapshot, columns: this.columns(), sort: this.sortBy(), expanded: this.expanded(), filter: this.filter() });
  });

  /** What the row selected stands for, while it is still on the list. */
  private readonly selected = computed<Selected | null>(() => {
    const id = this.selectedId();
    const built = this.built();
    if (id === null || built === null) {
      return null;
    }
    const process = built.processes.get(id);
    if (process !== undefined) {
      return { kind: 'process', process };
    }
    const group = built.groups.get(id);
    return group === undefined ? null : { kind: 'group', group };
  });

  /** The processes the row selected stands for. */
  private readonly selectedProcesses = computed<readonly FsProcess[]>(() => {
    const selected = this.selected();
    return selected === null ? [] : selected.kind === 'process' ? [selected.process] : selected.group.processes;
  });

  readonly canEnd = computed(() => (this.snapshot()?.canEnd ?? false) && this.selectedProcesses().length > 0);

  readonly model = computed<UiProcessListModel>(() => {
    const snapshot = this.snapshot();
    const built = this.built();
    const failure = this.failure();
    const filter = this.filter();
    const paused = this.paused();
    const base = {
      selectedId: built?.rows.some((row) => row.id === this.selectedId()) ? this.selectedId() : null,
      filter,
      paused,
      canEnd: this.canEnd(),
      ...(this.endTitle() === null ? {} : { endTitle: this.endTitle() as string }),
    };
    if (built === null || snapshot === null) {
      return {
        ...base,
        columns: [],
        rows: [],
        empty:
          snapshot !== null && !snapshot.available
            ? { icon: 'lock', title: 'Task Manager is not available here', ...(snapshot.reason === null ? {} : { hint: snapshot.reason }) }
            : failure !== null
              ? { icon: 'alert-triangle', title: 'Could not read the processes', hint: failure }
              : { icon: 'activity', title: 'Measuring the processes…' },
      };
    }
    const total = snapshot.processes.length;
    const count = filter.trim() === '' ? `${total} processes` : `${built.matching} of ${total} processes`;
    return {
      ...base,
      columns: built.columns,
      rows: built.rows,
      summary: [count, paused ? 'paused' : failure === null ? null : 'not updating'].filter(Boolean).join(' · '),
      ...(built.rows.length === 0 ? { empty: { icon: 'search', title: `No process matches '${filter.trim()}'` } } : {}),
    };
  });

  /** Why *End task* cannot be pressed, when it is not for want of a row. */
  private readonly endTitle = computed<string | null>(() => {
    const snapshot = this.snapshot();
    if (snapshot !== null && !snapshot.canEnd) {
      return snapshot.endReason ?? 'Ending processes is not allowed here.';
    }
    return null;
  });

  /** The status bar's words while Task Manager is shown. */
  readonly statusItems = computed<readonly UiStatusItem[]>(() => {
    const snapshot = this.snapshot();
    const items: UiStatusItem[] = [];
    if (snapshot?.available) {
      const { totals } = snapshot;
      const memory = totals.memoryTotal === 0 ? 0 : Math.round((totals.memoryUsed / totals.memoryTotal) * 100);
      items.push(
        { id: 'tm-processes', label: `Processes: ${totals.processes}` },
        { id: 'tm-cpu', label: `CPU: ${Math.round(totals.cpu)}%`, title: `${snapshot.cpuCount} logical processors` },
        { id: 'tm-memory', label: `Memory: ${memory}%`, title: `${formatMemory(totals.memoryUsed)} of ${formatMemory(totals.memoryTotal)} in use` },
      );
    }
    items.push(
      this.paused()
        ? { id: 'tm-pause', label: 'Updates paused', icon: 'play', title: 'Resume updates' }
        : { id: 'tm-pause', label: 'Updating every 2 s', icon: 'player-pause', title: 'Pause updates' },
    );
    return items;
  });

  /** Whether the column is shown; `name` always is. */
  isShown(column: ProcessColumnId): boolean {
    return column === 'name' || this.columns().includes(column);
  }

  /** Whether the row selected is a group, and open. */
  readonly selectedGroup = computed(() => {
    const selected = this.selected();
    return selected?.kind === 'group' ? selected.group : null;
  });

  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  /** A process with an executable the file manager can show (on the desktop's own computer). */
  readonly canOpenLocation = computed(() => {
    const path = this.selectedProcesses()[0]?.path ?? null;
    return path !== null && this.parent.fileSystem.systemFt.sharesFiles(this.parent.connection.connected());
  });

  readonly hasSelection = computed(() => this.selected() !== null);

  /* -- what the list reports -------------------------------------------------- */

  select(id: string): void {
    this.selectedId.set(id);
  }

  toggle(id: string): void {
    // Closing the group the selection is in leaves the group selected, not a process no longer on screen.
    const group = this.built()?.groups.get(id);
    const selected = this.selectedId();
    if (group !== undefined && this.expanded().has(id) && group.processes.some((process) => `p:${process.key}` === selected)) {
      this.selectedId.set(id);
    }
    this.expanded.update((open) => {
      const next = new Set(open);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** The column clicked again turns the order round; a number is largest first the first time, as in Task Manager. */
  sort(column: string): void {
    const def = PROCESS_COLUMNS.find((candidate) => candidate.id === column);
    if (def === undefined) {
      return;
    }
    this.sortBy.update((sort) =>
      sort.column === def.id ? { column: def.id, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { column: def.id, direction: def.numeric ? 'desc' : 'asc' },
    );
    this.remember();
  }

  toggleColumn(column: ProcessColumnId): void {
    if (column === 'name') {
      return;
    }
    this.columns.update((shown) => (shown.includes(column) ? shown.filter((id) => id !== column) : [...shown, column]));
    if (!this.isShown(this.sortBy().column)) {
      this.sortBy.set({ column: 'name', direction: 'asc' });
    }
    this.remember();
  }

  setFilter(value: string): void {
    this.filter.set(value);
  }

  focusFilter(): void {
    this.filterFocus.update((token) => token + 1);
  }

  togglePause(): void {
    this.paused.update((paused) => !paused);
  }

  /** Asks now, not at the next interval. */
  refresh(): void {
    this.stopPolling();
    if (this.running()) {
      void this.poll();
    }
  }

  openMenu(request: UiProcessMenuRequest): void {
    const menus = this.parent.contextMenuFt;
    const target = this.parent.commandsFt.activeTarget();
    if (request.target === 'header') {
      menus.show({ target: null, x: request.x, y: request.y }, 'Columns', COLUMN_MENU, target);
      return;
    }
    this.selectedId.set(request.target);
    menus.show({ target: request.target, x: request.x, y: request.y }, 'Process actions', ROW_MENU, target);
  }

  /* -- the commands ----------------------------------------------------------- */

  /**
   * *End task* — or, with `tree`, *End process tree* — on the row selected:
   * its process, or every process of its group. Task Manager asks first only
   * for a tree, and for the system's own processes; so does this.
   */
  async endSelected(tree: boolean): Promise<void> {
    const selected = this.selected();
    if (selected === null || !this.canEnd() || this.ending) {
      return;
    }
    const processes = this.selectedProcesses();
    const name = selected.kind === 'process' ? selected.process.name : selected.group.label;
    const system = processes.some((process) => process.category === 'system');
    if (tree || system) {
      const sure = await this.parent.modal.confirm({
        message: tree ? `Do you want to end the process tree of '${name}'?` : `Do you want to end the system process '${name}'?`,
        detail: tree
          ? 'Every process it started ends with it. A program among them closes, and what it has not saved is lost.'
          : 'Ending a process the system relies on can leave it unstable, or shut it down.',
        confirmLabel: tree ? 'End process tree' : 'End process',
      });
      if (!sure) {
        return;
      }
    }
    // A group's tree is the tree of each of its processes not started by another of them.
    const keys = new Set(processes.map((process) => process.pid));
    const targets = tree ? processes.filter((process) => !keys.has(process.ppid)) : processes;
    this.ending = true;
    const failures: string[] = [];
    try {
      for (const process of targets) {
        try {
          const result = await this.parent.fileSystem.processesFt.end(process.key, tree);
          failures.push(...result.failed.map((failure) => failure.message));
        } catch (error) {
          const failure = FsError.from(error);
          // One of a group already gone with another is not a failure.
          if (failure.code !== 'NOT_FOUND') {
            failures.push(failure.message);
          }
        }
      }
    } finally {
      this.ending = false;
    }
    this.refresh();
    if (failures.length > 0) {
      await this.parent.modal.message({
        severity: 'error',
        message: `Could not end '${name}'.`,
        detail: [...new Set(failures)].join('\n'),
      });
    }
    this.shown();
  }

  /** Shows the selected process's executable in the file manager, selected in its folder. */
  async openLocation(): Promise<void> {
    const path = this.selectedProcesses()[0]?.path ?? null;
    if (path === null || !this.canOpenLocation()) {
      return;
    }
    this.parent.subAppsFt.show('file-manager');
    await this.parent.fileBrowserFt.goToLocation(this.parent.activeGroupId(), path);
  }

  /** The selected process — or each of a group's — as text: name, pid, user, path, command line. */
  async copyDetails(): Promise<void> {
    const text = this.selectedProcesses()
      .map((process) =>
        [
          `${process.name} (PID ${process.pid})`,
          process.title === null ? null : `Window: ${process.title}`,
          process.user === null ? null : `User: ${process.user}`,
          process.path === null ? null : `Path: ${process.path}`,
          process.command === null ? null : `Command line: ${process.command}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
    if (text === '') {
      return;
    }
    try {
      await this.parent.fileSystem.systemFt.copyText(text);
    } catch (error) {
      await this.parent.modal.message({ severity: 'error', message: 'Could not copy the details.', detail: FsError.from(error).message });
    }
  }

  /* -- polling ---------------------------------------------------------------- */

  /** Asks for the latest sample, then again an interval after the answer: never two asks at once. */
  private async poll(): Promise<void> {
    if (this.asking) {
      return;
    }
    this.stopPolling();
    this.asking = true;
    let delay = TASK_MANAGER_POLL_MS;
    try {
      const graph = this.view() === 'graph';
      const [snapshot, history] = await Promise.all([
        this.parent.fileSystem.processesFt.list(),
        graph ? this.parent.fileSystem.processesFt.history([]) : Promise.resolve(null),
      ]);
      // An answer that lands after a pause is not drawn: the list and the graphs stand still once paused.
      if (!this.paused()) {
        this.snapshot.set(snapshot);
        if (history !== null) {
          this.history.set(history);
        }
      }
      this.failure.set(null);
      delay = snapshot.intervalMs > 0 ? snapshot.intervalMs : TASK_MANAGER_POLL_MS;
    } catch (error) {
      this.failure.set(FsError.from(error).message);
      delay = RETRY_MS;
    } finally {
      this.asking = false;
    }
    if (this.running() && this.parent.subAppsFt.isActive('task-manager') && !this.paused()) {
      this.timer = setTimeout(() => void this.poll(), delay);
    }
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private remember(): void {
    this.parent.settings.set(TASK_MANAGER_KEY, {
      columns: this.columns(),
      sort: this.sortBy(),
      view: this.view(),
      span: this.span(),
      cpuView: this.cpuView(),
    } satisfies Remembered);
  }
}
