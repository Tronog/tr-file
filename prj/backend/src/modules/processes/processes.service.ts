import { cpus, freemem, totalmem } from 'node:os';

import { HttpError, type Logger } from '../../core/index.js';
import { SampleRing } from './process-history.js';
import {
  PROCESS_HISTORY_SAMPLES,
  PROCESS_SAMPLE_MS,
  type ProcessDto,
  type ProcessEndRequest,
  type ProcessEndResultDto,
  type ProcessesHistoryDto,
  type ProcessesInfoDto,
  type ProcessesSnapshotDto,
  type ProcessSource,
  type ProcessTotalsDto,
  type RawProcess,
} from './processes.model.js';
import { LinuxProcessSource } from './sources/linux-process-source.js';
import { PsProcessSource } from './sources/ps-process-source.js';
import { WindowsProcessSource } from './sources/windows-process-source.js';

/** How long a process asked to end gently has before it is made to. */
const END_GRACE_MS = 5000;

export interface ProcessesServiceOptions {
  /**
   * Whether the processes are measured and listed at all. They say what runs
   * on the machine and as whom — on the user's own computer that is theirs to
   * see; a server has to say yes (`PROCESSES_ENABLED`).
   */
  readonly enabled: boolean;
  /** Whether a process may be ended from here (`PROCESSES_KILL_ENABLED`). */
  readonly canEnd: boolean;
  /** Stands in for the machine in tests. */
  readonly source?: ProcessSource;
  readonly intervalMs?: number;
  /** Ends a process; `process.kill` but in tests. */
  readonly kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
}

/** What one sample keeps of a process, to measure the next against. */
interface Seen {
  readonly cpuMs: number;
  readonly ioBytes: number | null;
}

/** The whole machine's CPU counters, all cores together. */
interface CpuTimes {
  readonly idle: number;
  readonly total: number;
}

const keyOf = (raw: RawProcess): string => `${raw.pid}:${raw.started === null ? 0 : Math.round(raw.started)}`;

/**
 * The backend machine's processes (PRD 014, §1): measured every
 * `PROCESS_SAMPLE_MS` from the moment the backend starts, whether anyone is
 * looking or not, and the last ten minutes kept — the machine's CPU, memory
 * and disk, and each running process's — so whoever opens Task Manager sees
 * where things have been, not only where they are.
 *
 * A source reads counters that only grow (CPU time, bytes moved); a rate is
 * the difference from the sample before, so the first sample of a process
 * shows it idle. CPU is a share of the *whole* machine, every core together,
 * as Task Manager shows it. The machine's own CPU and memory come from the
 * operating system, not from adding the processes up.
 *
 * A process is known by its pid *and* its start (`key`), so a pid handed out
 * again is a new process with a new history — and *End task* names the key,
 * so it can never end a stranger that inherited a pid.
 */
export class ProcessesService {
  private readonly source: ProcessSource | null;
  private readonly intervalMs: number;
  private readonly kill: (pid: number, signal: NodeJS.Signals | 0) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  private sequence = 0;
  private at: number | null = null;
  private processes: readonly ProcessDto[] = [];
  private totals: ProcessTotalsDto = { cpu: 0, memoryUsed: 0, memoryTotal: totalmem(), disk: null, processes: 0, threads: null };
  private failure: string | null = null;

  private seen = new Map<string, Seen>();
  private seenAt: number | null = null;
  private cpuTimes: CpuTimes | null = null;
  private readonly machine = new SampleRing(PROCESS_HISTORY_SAMPLES);
  private readonly history = new Map<string, SampleRing>();

  constructor(
    private readonly logger: Logger,
    private readonly options: ProcessesServiceOptions,
  ) {
    this.source = options.enabled ? (options.source ?? ProcessesService.sourceFor(process.platform, logger)) : null;
    this.intervalMs = options.intervalMs ?? PROCESS_SAMPLE_MS;
    this.kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  }

  /** The source for this operating system. */
  static sourceFor(platform: NodeJS.Platform, logger: Logger): ProcessSource {
    switch (platform) {
      case 'linux':
        return new LinuxProcessSource();
      case 'win32':
        return new WindowsProcessSource(logger);
      default:
        return new PsProcessSource();
    }
  }

  /** Starts measuring, now and every interval after; nothing when switched off. */
  start(): void {
    if (this.source === null || this.timer !== null) {
      return;
    }
    void this.sample();
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    // Measuring never keeps the backend alive on its own.
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.close();
  }

  info(): ProcessesInfoDto {
    const available = this.source !== null && this.failure === null;
    return {
      available,
      reason:
        this.source === null
          ? 'Processes are switched off on this server (PROCESSES_ENABLED).'
          : this.failure === null
            ? null
            : `The processes could not be measured: ${this.failure}`,
      canEnd: available && this.options.canEnd,
      endReason: this.options.canEnd ? null : 'Ending processes is switched off on this server (PROCESSES_KILL_ENABLED).',
    };
  }

  /** The latest sample. */
  snapshot(): ProcessesSnapshotDto {
    return {
      ...this.info(),
      sequence: this.sequence,
      at: this.at === null ? null : new Date(this.at).toISOString(),
      intervalMs: this.intervalMs,
      platform: process.platform,
      cpuCount: Math.max(1, cpus().length),
      totals: this.totals,
      processes: this.processes,
    };
  }

  /** The machine's last ten minutes, and those of each process named that is still running. */
  historyOf(keys: readonly string[]): ProcessesHistoryDto {
    const processes: Record<string, ReturnType<SampleRing['series']>> = {};
    for (const key of keys) {
      const ring = this.history.get(key);
      if (ring !== undefined) {
        processes[key] = ring.series();
      }
    }
    return {
      intervalMs: this.intervalMs,
      at: this.at === null ? null : new Date(this.at).toISOString(),
      totals: { ...this.machine.series(), memoryTotal: this.totals.memoryTotal },
      processes,
    };
  }

  /**
   * Ends a process — or, with `tree`, it and everything it started, the
   * youngest first (Task Manager's *End task* and *End process tree*). Asked
   * to stop first (`SIGTERM`), and made to (`SIGKILL`) if it is still there
   * `END_GRACE_MS` later; on Windows either is the end at once.
   */
  async end(request: ProcessEndRequest): Promise<ProcessEndResultDto> {
    const info = this.info();
    if (!info.available) {
      throw HttpError.forbidden(info.reason ?? 'Processes are not available.');
    }
    if (!info.canEnd) {
      throw HttpError.forbidden(info.endReason ?? 'Ending processes is not allowed here.');
    }
    const target = this.processes.find((entry) => entry.key === request.key);
    if (target === undefined) {
      throw HttpError.notFound('That process has already ended.');
    }
    const doomed = request.tree === true ? this.treeOf(target) : [target];
    if (doomed.some((entry) => entry.pid === process.pid)) {
      throw HttpError.conflict('That would end tr-file itself.');
    }

    const ended: number[] = [];
    const failed: { pid: number; message: string }[] = [];
    for (const entry of doomed) {
      try {
        this.kill(entry.pid, 'SIGTERM');
        ended.push(entry.pid);
        if (process.platform !== 'win32') {
          setTimeout(() => this.finish(entry), END_GRACE_MS).unref();
        }
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') {
          ended.push(entry.pid);
        } else {
          failed.push({ pid: entry.pid, message: code === 'EPERM' ? 'Access is denied.' : (error as Error).message });
        }
      }
    }
    this.logger.info('processes ended', { key: request.key, tree: request.tree === true, ended, failed: failed.length });
    if (ended.length === 0 && failed.length > 0) {
      throw HttpError.forbidden(failed[0]?.message ?? 'The process could not be ended.', { failed });
    }
    // The list shows it gone without waiting for the next interval.
    void this.sample();
    return { ended, failed };
  }

  /** `SIGKILL` for a process asked to end that is still the same process. */
  private finish(entry: ProcessDto): void {
    if (this.processes.some((current) => current.key === entry.key)) {
      try {
        this.kill(entry.pid, 'SIGKILL');
      } catch {
        // Gone meanwhile, or never ours to end.
      }
    }
  }

  /** A process and all it started, deepest first; a child is one started after its parent, so a reused pid is no one's child. */
  private treeOf(root: ProcessDto): ProcessDto[] {
    const children = new Map<number, ProcessDto[]>();
    for (const entry of this.processes) {
      const siblings = children.get(entry.ppid) ?? [];
      siblings.push(entry);
      children.set(entry.ppid, siblings);
    }
    const order: ProcessDto[] = [];
    const visit = (parent: ProcessDto, depth: number): void => {
      if (depth > 64) {
        return;
      }
      for (const child of children.get(parent.pid) ?? []) {
        if (child.pid !== parent.pid && (parent.startedAt === null || child.startedAt === null || child.startedAt >= parent.startedAt)) {
          visit(child, depth + 1);
        }
      }
      order.push(parent);
    };
    visit(root, 0);
    return order;
  }

  /** Takes one sample. Public so a test can drive it; one at a time — a slow one makes the next wait its turn. */
  async sample(): Promise<void> {
    if (this.source === null || this.busy) {
      return;
    }
    this.busy = true;
    try {
      const raw = await this.source.sample();
      this.record(raw, Date.now());
      if (this.failure !== null) {
        this.logger.info('processes measured again');
      }
      this.failure = null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.failure !== message) {
        this.logger.warn('processes could not be measured', { error: message });
      }
      this.failure = message;
    } finally {
      this.busy = false;
    }
  }

  private record(raw: readonly RawProcess[], now: number): void {
    const elapsed = this.seenAt === null ? 0 : Math.max(1, now - this.seenAt);
    const cores = Math.max(1, cpus().length);
    const seen = new Map<string, Seen>();
    const processes: ProcessDto[] = [];
    let disk: number | null = null;
    let threads: number | null = null;

    for (const entry of raw) {
      const key = keyOf(entry);
      const before = this.seen.get(key);
      seen.set(key, { cpuMs: entry.cpuMs, ioBytes: entry.ioBytes });
      const cpu = before === undefined || elapsed === 0 ? 0 : Math.min(100, (Math.max(0, entry.cpuMs - before.cpuMs) / (elapsed * cores)) * 100);
      const rate =
        entry.ioBytes === null
          ? null
          : before === undefined || before.ioBytes === null || elapsed === 0
            ? 0
            : (Math.max(0, entry.ioBytes - before.ioBytes) * 1000) / elapsed;
      if (rate !== null) {
        disk = (disk ?? 0) + rate;
      }
      if (entry.threads !== null) {
        threads = (threads ?? 0) + entry.threads;
      }
      processes.push({
        pid: entry.pid,
        ppid: entry.ppid,
        key,
        name: entry.name,
        path: entry.path,
        command: entry.command,
        user: entry.user,
        title: entry.title,
        status: entry.status,
        category: entry.category,
        cpu: Math.round(cpu * 10) / 10,
        memory: entry.memory,
        disk: rate === null ? null : Math.round(rate),
        threads: entry.threads,
        startedAt: entry.started === null ? null : new Date(entry.started).toISOString(),
      });

      let ring = this.history.get(key);
      if (ring === undefined) {
        ring = new SampleRing(PROCESS_HISTORY_SAMPLES);
        this.history.set(key, ring);
      }
      ring.push(cpu, entry.memory, rate);
    }
    // A process that has ended takes its history with it.
    for (const key of this.history.keys()) {
      if (!seen.has(key)) {
        this.history.delete(key);
      }
    }

    const total = totalmem();
    const used = total - freemem();
    const machineCpu = this.machineCpu();
    this.totals = {
      cpu: Math.round(machineCpu * 10) / 10,
      memoryUsed: used,
      memoryTotal: total,
      disk: disk === null ? null : Math.round(disk),
      processes: processes.length,
      threads,
    };
    this.machine.push(machineCpu, used, disk);
    this.processes = processes;
    this.seen = seen;
    this.seenAt = now;
    this.at = now;
    this.sequence += 1;
  }

  /** The whole machine's CPU since the last sample, 0–100, from the operating system's own counters. */
  private machineCpu(): number {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus()) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
    }
    const before = this.cpuTimes;
    this.cpuTimes = { idle, total };
    if (before === null || total <= before.total) {
      return 0;
    }
    return Math.min(100, Math.max(0, (1 - (idle - before.idle) / (total - before.total)) * 100));
  }
}
