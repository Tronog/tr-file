import type { UiProcessCell, UiProcessColumn, UiProcessRow } from '@tr-file/file-ui';
import type { FsProcess, FsProcessCategory, FsProcessesSnapshot } from '../../file-system/file-system.model';

/** Task Manager's columns (PRD 014, §2): the first five shown at first, the rest added from the header's menu. */
export type ProcessColumnId = 'name' | 'status' | 'pid' | 'user' | 'cpu' | 'memory' | 'disk' | 'threads' | 'command';

export interface ProcessColumnDef {
  readonly id: ProcessColumnId;
  readonly label: string;
  readonly width: number;
  readonly numeric: boolean;
  /** Shown unless the user hides it. */
  readonly shown: boolean;
  readonly title?: string;
}

export const PROCESS_COLUMNS: readonly ProcessColumnDef[] = [
  { id: 'name', label: 'Name', width: 240, numeric: false, shown: true },
  { id: 'status', label: 'Status', width: 110, numeric: false, shown: true },
  { id: 'pid', label: 'PID', width: 72, numeric: true, shown: false, title: 'Process identifier' },
  { id: 'user', label: 'User name', width: 120, numeric: false, shown: false },
  { id: 'cpu', label: 'CPU', width: 76, numeric: true, shown: true, title: 'Share of all the processors together' },
  { id: 'memory', label: 'Memory', width: 100, numeric: true, shown: true, title: 'Memory the process alone holds' },
  { id: 'disk', label: 'Disk', width: 96, numeric: true, shown: true, title: 'Read from and written to storage' },
  { id: 'threads', label: 'Threads', width: 76, numeric: true, shown: false },
  { id: 'command', label: 'Command line', width: 360, numeric: false, shown: false },
];

export interface ProcessSort {
  readonly column: ProcessColumnId;
  readonly direction: 'asc' | 'desc';
}

/** The processes of one executable: one row, with its processes folded under it when there are several. */
export interface ProcessGroup {
  /** The row's id: `g:<executable>`, or the one process's `p:<key>` when it is alone. */
  readonly id: string;
  readonly category: FsProcessCategory;
  readonly label: string;
  readonly processes: readonly FsProcess[];
  readonly cpu: number;
  readonly memory: number;
  readonly disk: number | null;
  readonly threads: number | null;
}

/** What the rows are built from. */
export interface ProcessRowsInput {
  readonly snapshot: FsProcessesSnapshot;
  readonly columns: readonly ProcessColumnId[];
  readonly sort: ProcessSort;
  readonly expanded: ReadonlySet<string>;
  readonly filter: string;
}

export interface ProcessRows {
  readonly columns: readonly UiProcessColumn[];
  readonly rows: readonly UiProcessRow[];
  /** Every group on screen, by row id — and every process, by `p:<key>`. */
  readonly groups: ReadonlyMap<string, ProcessGroup>;
  readonly processes: ReadonlyMap<string, FsProcess>;
  /** How many processes the filter left. */
  readonly matching: number;
}

const SECTIONS: readonly FsProcessCategory[] = ['app', 'background', 'system'];

const RANK: Readonly<Record<FsProcessCategory, number>> = { app: 0, background: 1, system: 2 };

/** Row id of a process. */
export const processRowId = (process: FsProcess): string => `p:${process.key}`;

/**
 * The rows of Task Manager's *Processes* tab (PRD 014, §2), from one sample:
 * the processes of one executable gathered into one row (an app's many
 * processes are one app), the rows under the three headings — *Apps*,
 * *Background processes*, the system's — each sorted by the column chosen,
 * and a group's processes under it, in the same order, while it is open.
 *
 * A group is the heading of the most visible of its processes: an app with
 * helpers in the background is an app. A filter keeps the processes whose
 * name, window title, pid, user or command line hold it, and opens every
 * group so they are seen.
 */
export function buildProcessRows(input: ProcessRowsInput): ProcessRows {
  const { snapshot, sort } = input;
  const needle = input.filter.trim().toLowerCase();
  const matches = needle === '' ? snapshot.processes : snapshot.processes.filter((process) => matchesFilter(process, needle));
  const groups = groupProcesses(matches, snapshot.platform);
  const shown = PROCESS_COLUMNS.filter((column) => column.id === 'name' || input.columns.includes(column.id));
  const memoryTotal = Math.max(1, snapshot.totals.memoryTotal);

  const columns: UiProcessColumn[] = shown.map((column) => ({
    id: column.id,
    label: column.label,
    width: column.width,
    numeric: column.numeric,
    ...(column.title === undefined ? {} : { title: column.title }),
    ...(sort.column === column.id ? { sort: sort.direction } : {}),
    ...totalOf(column.id, snapshot),
  }));

  const rows: UiProcessRow[] = [];
  const byId = new Map<string, ProcessGroup>();
  const processes = new Map<string, FsProcess>();
  for (const section of SECTIONS) {
    const inSection = groups.filter((group) => group.category === section).sort((a, b) => compareGroups(a, b, sort));
    if (inSection.length === 0) {
      continue;
    }
    rows.push({ id: `s:${section}`, kind: 'section', level: 0, label: `${sectionLabel(section, snapshot.platform)} (${inSection.length})`, cells: {} });
    for (const group of inSection) {
      byId.set(group.id, group);
      const alone = group.processes.length === 1 ? group.processes[0] : undefined;
      if (alone !== undefined) {
        processes.set(group.id, alone);
        rows.push(processRow(alone, 1, shown, memoryTotal));
        continue;
      }
      const open = needle !== '' || input.expanded.has(group.id);
      rows.push({
        id: group.id,
        kind: 'group',
        level: 1,
        label: group.label,
        detail: `(${group.processes.length})`,
        icon: section === 'app' ? 'layout-grid' : 'list',
        expandable: true,
        expanded: open,
        cells: groupCells(group, shown, memoryTotal),
        title: group.processes[0]?.path ?? group.label,
        warning: group.processes.some((process) => process.status === 'not-responding'),
      });
      for (const process of [...group.processes].sort((a, b) => compareProcesses(a, b, sort))) {
        processes.set(processRowId(process), process);
        if (open) {
          rows.push(processRow(process, 2, shown, memoryTotal));
        }
      }
    }
  }
  return { columns, rows, groups: byId, processes, matching: matches.length };
}

/** The processes gathered by executable — its path, or for one with none its name (a kernel thread's, to its first `/`). */
export function groupProcesses(processes: readonly FsProcess[], platform: string): ProcessGroup[] {
  const byKey = new Map<string, FsProcess[]>();
  const labels = new Map<string, string>();
  for (const process of processes) {
    const key = executableKey(process, platform);
    const members = byKey.get(key) ?? [];
    members.push(process);
    byKey.set(key, members);
    if (!labels.has(key)) {
      labels.set(key, process.path === null && process.command === null ? kernelName(process.name) : process.name);
    }
  }
  return [...byKey.entries()].map(([key, members]) => {
    const alone = members.length === 1 ? members[0] : undefined;
    const disks = members.map((process) => process.disk).filter((disk): disk is number => disk !== null);
    const threads = members.map((process) => process.threads).filter((count): count is number => count !== null);
    return {
      id: alone === undefined ? `g:${key}` : processRowId(alone),
      category: members.reduce<FsProcessCategory>((best, process) => (RANK[process.category] < RANK[best] ? process.category : best), 'system'),
      label: alone?.name ?? labels.get(key) ?? key,
      processes: members,
      cpu: members.reduce((total, process) => total + process.cpu, 0),
      memory: members.reduce((total, process) => total + process.memory, 0),
      disk: disks.length === 0 ? null : disks.reduce((total, disk) => total + disk, 0),
      threads: threads.length === 0 ? null : threads.reduce((total, count) => total + count, 0),
    };
  });
}

/**
 * By the executable's name rather than its path: another account's process
 * may not say where its executable is, and it is still the same program.
 */
function executableKey(process: FsProcess, platform: string): string {
  if (process.path === null && process.command === null) {
    return `kernel:${kernelName(process.name)}`;
  }
  return platform === 'win32' ? process.name.toLowerCase() : process.name;
}

/** `kworker/3:1-events` is a `kworker`: the kernel's threads are many of a few kinds. */
function kernelName(name: string): string {
  return name.replace(/[/:].*$/, '') || name;
}

function matchesFilter(process: FsProcess, needle: string): boolean {
  return [process.name, process.title, String(process.pid), process.user, process.command].some((value) => value?.toLowerCase().includes(needle));
}

function sectionLabel(section: FsProcessCategory, platform: string): string {
  switch (section) {
    case 'app':
      return 'Apps';
    case 'background':
      return 'Background processes';
    default:
      return platform === 'win32' ? 'Windows processes' : 'System processes';
  }
}

function processRow(process: FsProcess, level: number, columns: readonly ProcessColumnDef[], memoryTotal: number): UiProcessRow {
  const cells: Record<string, UiProcessCell> = {};
  for (const column of columns) {
    const cell = processCell(column.id, process, memoryTotal);
    if (cell !== null) {
      cells[column.id] = cell;
    }
  }
  return {
    id: processRowId(process),
    kind: 'process',
    level,
    label: process.name,
    ...(process.title === null ? {} : { detail: process.title }),
    icon: process.category === 'app' ? 'layout-grid' : process.path === null && process.command === null ? 'settings' : 'terminal',
    cells,
    title: [process.path ?? process.name, process.command, process.user === null ? null : `User: ${process.user}`, `PID ${process.pid}`].filter(Boolean).join('\n'),
    warning: process.status === 'not-responding',
  };
}

function processCell(column: ProcessColumnId, process: FsProcess, memoryTotal: number): UiProcessCell | null {
  switch (column) {
    case 'status':
      return { text: statusLabel(process) };
    case 'pid':
      return { text: String(process.pid) };
    case 'user':
      return { text: process.user ?? '' };
    case 'cpu':
      return { text: formatPercent(process.cpu), heat: cpuHeat(process.cpu) };
    case 'memory':
      return { text: formatMemory(process.memory), heat: memoryHeat(process.memory, memoryTotal) };
    case 'disk':
      return { text: process.disk === null ? '—' : formatRate(process.disk), heat: diskHeat(process.disk ?? 0) };
    case 'threads':
      return { text: process.threads === null ? '' : String(process.threads) };
    case 'command':
      return { text: process.command ?? '' };
    default:
      return null;
  }
}

function groupCells(group: ProcessGroup, columns: readonly ProcessColumnDef[], memoryTotal: number): Record<string, UiProcessCell> {
  const cells: Record<string, UiProcessCell> = {};
  for (const column of columns) {
    switch (column.id) {
      case 'status': {
        const statuses = group.processes.map((process) => process.status);
        cells['status'] = {
          text: statuses.includes('not-responding') ? 'Not responding' : statuses.every((status) => status === 'suspended') ? 'Suspended' : '',
        };
        break;
      }
      case 'user': {
        const users = new Set(group.processes.map((process) => process.user));
        cells['user'] = { text: users.size === 1 ? ([...users][0] ?? '') : '' };
        break;
      }
      case 'cpu':
        cells['cpu'] = { text: formatPercent(group.cpu), heat: cpuHeat(group.cpu) };
        break;
      case 'memory':
        cells['memory'] = { text: formatMemory(group.memory), heat: memoryHeat(group.memory, memoryTotal) };
        break;
      case 'disk':
        cells['disk'] = { text: group.disk === null ? '—' : formatRate(group.disk), heat: diskHeat(group.disk ?? 0) };
        break;
      case 'threads':
        cells['threads'] = { text: group.threads === null ? '' : String(group.threads) };
        break;
      default:
        break;
    }
  }
  return cells;
}

/** Above each measured column, the whole machine's. */
function totalOf(column: ProcessColumnId, snapshot: FsProcessesSnapshot): Pick<UiProcessColumn, 'total' | 'totalHeat'> {
  const { totals } = snapshot;
  switch (column) {
    case 'cpu':
      return { total: `${Math.round(totals.cpu)}%`, totalHeat: totals.cpu / 100 };
    case 'memory': {
      const share = totals.memoryTotal === 0 ? 0 : (totals.memoryUsed / totals.memoryTotal) * 100;
      return { total: `${Math.round(share)}%`, totalHeat: share / 100 };
    }
    case 'disk':
      return totals.disk === null ? {} : { total: formatRate(totals.disk), totalHeat: diskHeat(totals.disk) };
    default:
      return {};
  }
}

/** Only what is worth a word, as Task Manager says it; a running or sleeping process says nothing. */
export function statusLabel(process: FsProcess): string {
  switch (process.status) {
    case 'suspended':
      return 'Suspended';
    case 'not-responding':
      return 'Not responding';
    case 'zombie':
      return 'Ended';
    default:
      return '';
  }
}

function compareGroups(a: ProcessGroup, b: ProcessGroup, sort: ProcessSort): number {
  const order = compareValues(groupValue(a, sort.column), groupValue(b, sort.column));
  const directed = sort.direction === 'asc' ? order : -order;
  return directed !== 0 ? directed : a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
}

function compareProcesses(a: FsProcess, b: FsProcess, sort: ProcessSort): number {
  const order = compareValues(processValue(a, sort.column), processValue(b, sort.column));
  const directed = sort.direction === 'asc' ? order : -order;
  return directed !== 0 ? directed : a.pid - b.pid;
}

function groupValue(group: ProcessGroup, column: ProcessColumnId): string | number {
  switch (column) {
    case 'cpu':
      return group.cpu;
    case 'memory':
      return group.memory;
    case 'disk':
      return group.disk ?? -1;
    case 'threads':
      return group.threads ?? -1;
    case 'pid':
      return Math.min(...group.processes.map((process) => process.pid));
    default: {
      const first = group.processes[0];
      return column === 'name' || first === undefined ? group.label : processValue(first, column);
    }
  }
}

function processValue(process: FsProcess, column: ProcessColumnId): string | number {
  switch (column) {
    case 'name':
      return process.title ?? process.name;
    case 'status':
      return statusLabel(process);
    case 'pid':
      return process.pid;
    case 'user':
      return process.user ?? '';
    case 'cpu':
      return process.cpu;
    case 'memory':
      return process.memory;
    case 'disk':
      return process.disk ?? -1;
    case 'threads':
      return process.threads ?? -1;
    case 'command':
      return process.command ?? '';
  }
}

function compareValues(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/* -- formatting and shading, as Task Manager does ---------------------------- */

/** `0%`, `0.4%`, `12.5%`. */
export function formatPercent(value: number): string {
  return value < 0.05 ? '0%' : `${value < 100 ? value.toFixed(1) : '100'}%`;
}

/** `12.4 MB` — Task Manager counts memory in megabytes. */
export function formatMemory(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10_000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/** `0 MB/s`, `0.1 MB/s`, `12.3 MB/s`. */
export function formatRate(bytesPerSecond: number): string {
  const mb = bytesPerSecond / (1024 * 1024);
  return mb <= 0 ? '0 MB/s' : mb < 0.1 ? '0.1 MB/s' : `${mb.toFixed(1)} MB/s`;
}

/** Shading rises fast at first, so a process using a little is already told from one using none. */
export function cpuHeat(percent: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, percent) / 100));
}

export function memoryHeat(bytes: number, total: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, bytes) / (total * 0.5)));
}

/** 100 MB/s is as loaded as a disk is drawn. */
export function diskHeat(bytesPerSecond: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, bytesPerSecond) / (100 * 1024 * 1024)));
}
