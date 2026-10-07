/**
 * The processes of the backend machine (PRD 014, §1) — what Windows 10's Task
 * Manager shows on its *Processes* tab: each process's CPU, memory and disk,
 * sampled on the backend every `PROCESS_SAMPLE_MS` while someone watches
 * and every `PROCESS_IDLE_SAMPLE_MS` while no one does (§4.1), and the last
 * ten minutes of it kept.
 */

/** How often the processes are measured while Task Manager is shown somewhere (PRD 014, §4.1). */
export const PROCESS_SAMPLE_MS = 2000;

/** How often while it is not: no client has Task Manager shown. */
export const PROCESS_IDLE_SAMPLE_MS = 10_000;

/**
 * How long a client's ask counts as watching: a little over two of its
 * two-second polls, so one slow answer does not drop the pace.
 */
export const PROCESS_WATCH_LEASE_MS = 5000;

/** How far back the history reaches. */
export const PROCESS_HISTORY_MS = 10 * 60 * 1000;

/** How many samples are kept: ten minutes of them at the faster pace. */
export const PROCESS_HISTORY_SAMPLES = PROCESS_HISTORY_MS / PROCESS_SAMPLE_MS;

/**
 * Task Manager's three headings: *Apps* (a process with a window of its own —
 * on Linux, a session of the account the backend runs as), *Background
 * processes*, and the system's own (*Windows processes*; root's and the
 * kernel's elsewhere).
 */
export type ProcessCategory = 'app' | 'background' | 'system';

/**
 * What a process is doing. Most are `running`; Task Manager shows only what is
 * worth a word — `suspended` (stopped), `not-responding` (a window that has
 * stopped answering, Windows only) and `zombie` (ended, not yet reaped).
 */
export type ProcessStatus = 'running' | 'sleeping' | 'waiting' | 'suspended' | 'not-responding' | 'zombie' | 'idle';

/** One process, as the latest sample saw it. */
export interface ProcessDto {
  readonly pid: number;
  /** `0` when it has none, or it is not known. */
  readonly ppid: number;
  /**
   * The process's identity across samples: its pid and when it started, so a
   * pid the system hands out again is never taken for the process before it.
   * `End task` names it, so the wrong process is never ended.
   */
  readonly key: string;
  /** Its executable's name, without a directory — `chrome.exe`, `node`. */
  readonly name: string;
  /** The executable on the backend's disk, when the backend may know it. */
  readonly path: string | null;
  /** The command line, when the backend may read it. */
  readonly command: string | null;
  /** The account it runs as, when known. */
  readonly user: string | null;
  /** A window title, for an app that has one (Windows only). */
  readonly title: string | null;
  readonly status: ProcessStatus;
  readonly category: ProcessCategory;
  /** Its share of the whole machine's CPU over the last interval, 0–100. */
  readonly cpu: number;
  /**
   * Memory it alone holds, in bytes: private bytes on Windows, its resident
   * anonymous memory on Linux, its resident size elsewhere.
   */
  readonly memory: number;
  /** Bytes read and written per second over the last interval; `null` when the backend may not see it. */
  readonly disk: number | null;
  readonly threads: number | null;
  /** When it started, ISO 8601; `null` when not known. */
  readonly startedAt: string | null;
}

/** The whole machine, over the same interval. */
export interface ProcessTotalsDto {
  /** All CPUs together, 0–100. */
  readonly cpu: number;
  readonly memoryUsed: number;
  readonly memoryTotal: number;
  /** Bytes per second, the processes' disk added up; `null` when none could be seen. */
  readonly disk: number | null;
  /** The same, read and written apart (PRD 014, §2.1: the Disk graph's two lines). */
  readonly diskRead: number | null;
  readonly diskWrite: number | null;
  readonly processes: number;
  readonly threads: number | null;
  /** Each logical processor's load, 0–100, in the order the system numbers them. */
  readonly cores: readonly number[];
  /** Each network adapter's throughput, bytes a second. */
  readonly network: readonly NetworkAdapterDto[];
}

/** One network adapter, as Task Manager's Performance tab shows it. */
export interface NetworkAdapterDto {
  readonly name: string;
  readonly send: number;
  readonly receive: number;
}

/** What the CPU and the machine are (PRD 014, §2.1: the numbers under the CPU graph). */
export interface MachineInfoDto {
  readonly cpuModel: string;
  /** Current speed of the first processor, MHz; `0` when the system does not say. */
  readonly cpuSpeedMhz: number;
  readonly uptimeSeconds: number;
  readonly hostname: string;
}

/** What may be done here: listing, and ending a process. */
export interface ProcessesInfoDto {
  readonly available: boolean;
  /** Why not, when not: switched off, or the measuring failed. */
  readonly reason: string | null;
  readonly canEnd: boolean;
  /** Why ending a process is not offered. */
  readonly endReason: string | null;
}

/** `GET /api/processes`: the latest sample. */
export interface ProcessesSnapshotDto extends ProcessesInfoDto {
  /** Counts up with every sample, so a client can tell a new one from the last. */
  readonly sequence: number;
  /** When it was taken, ISO 8601; `null` before the first. */
  readonly at: string | null;
  /** How often it is measured now: `PROCESS_SAMPLE_MS` while watched, `PROCESS_IDLE_SAMPLE_MS` otherwise. */
  readonly intervalMs: number;
  readonly platform: NodeJS.Platform;
  readonly cpuCount: number;
  readonly totals: ProcessTotalsDto;
  readonly machine: MachineInfoDto;
  readonly processes: readonly ProcessDto[];
}

/** A series of samples, oldest first, ending at the latest — each value taken at the matching one of the last of `times`. */
export interface ProcessSeriesDto {
  readonly cpu: readonly number[];
  readonly memory: readonly number[];
  readonly disk: readonly (number | null)[];
}

/**
 * `GET /api/processes/history`: the machine's last ten minutes and, for each
 * process asked for that is still running, as much of them as it was seen.
 */
export interface ProcessesHistoryDto {
  readonly intervalMs: number;
  /** When the last of them was taken. */
  readonly at: string | null;
  /**
   * When each sample of the last ten minutes was taken, ms since the epoch,
   * oldest first — two seconds apart while watched, ten while not (§4.1). A
   * series shorter than this (a process started since, an adapter come up)
   * matches its end.
   */
  readonly times: readonly number[];
  readonly totals: ProcessSeriesDto & {
    readonly memoryTotal: number;
    readonly diskRead: readonly (number | null)[];
    readonly diskWrite: readonly (number | null)[];
    /** One series per logical processor. */
    readonly cores: readonly (readonly number[])[];
    /** By adapter name; an adapter seen later than the rest has a shorter series. */
    readonly network: Readonly<Record<string, { readonly send: readonly number[]; readonly receive: readonly number[] }>>;
  };
  readonly processes: Readonly<Record<string, ProcessSeriesDto>>;
}

/** `POST /api/processes/end`: a process ended, or its whole tree. */
export interface ProcessEndRequest {
  /** The process, by its `key` — never a bare pid. */
  readonly key: string;
  /** Its children too, and theirs, children first (Task Manager's *End process tree*). */
  readonly tree?: boolean;
}

export interface ProcessEndResultDto {
  /** The pids signalled. */
  readonly ended: readonly number[];
  /** The pids that could not be, with why. */
  readonly failed: readonly { readonly pid: number; readonly message: string }[];
}

/**
 * One process as a `ProcessSource` reads it: counters that only ever grow
 * (CPU time, bytes moved), turned into rates by comparing two samples.
 */
export interface RawProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly path: string | null;
  readonly command: string | null;
  readonly user: string | null;
  readonly title: string | null;
  readonly status: ProcessStatus;
  readonly category: ProcessCategory;
  /** User and kernel CPU time so far, in milliseconds. */
  readonly cpuMs: number;
  readonly memory: number;
  /** Bytes read from and written to storage so far; `null` when they cannot be read. */
  readonly ioRead: number | null;
  readonly ioWrite: number | null;
  readonly threads: number | null;
  /** Start time, ms since the epoch — or any number that stays the same for the process's life. */
  readonly started: number | null;
}

/** One network adapter's counters: bytes so far. */
export interface RawAdapter {
  readonly name: string;
  readonly received: number;
  readonly sent: number;
}

/** Reads every process of the machine. */
export interface ProcessSource {
  sample(): Promise<readonly RawProcess[]>;
  /** The network adapters' counters, read with (or just after) the last sample; none where not known. */
  adapters?(): Promise<readonly RawAdapter[]>;
  /** Lets go of anything kept running between samples. */
  close(): void;
}
