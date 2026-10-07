import { cpus, freemem, hostname, totalmem, uptime } from 'node:os';

import { HttpError, type Logger } from '../../core/index.js';
import { SampleRing, ValueRing } from './process-history.js';
import {
  PROCESS_HISTORY_MS,
  PROCESS_HISTORY_SAMPLES,
  PROCESS_IDLE_SAMPLE_MS,
  PROCESS_SAMPLE_MS,
  PROCESS_WATCH_LEASE_MS,
  type ProcessDto,
  type ProcessEndRequest,
  type ProcessEndResultDto,
  type ProcessesHistoryDto,
  type ProcessesInfoDto,
  type ProcessesSnapshotDto,
  type ProcessSource,
  type ProcessTotalsDto,
  type MachineInfoDto,
  type NetworkAdapterDto,
  type RawAdapter,
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
  /** The pace while watched, and while not (PRD 014, §4.1). */
  readonly intervalMs?: number;
  readonly idleIntervalMs?: number;
  /** Ends a process; `process.kill` but in tests. */
  readonly kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
}

/** What one sample keeps of a process, to measure the next against. */
interface Seen {
  readonly cpuMs: number;
  readonly ioRead: number | null;
  readonly ioWrite: number | null;
}

/** One logical processor's counters. */
interface CpuTimes {
  readonly idle: number;
  readonly total: number;
}

/** What the machine's graphs keep (PRD 014, §2.1): ten minutes of each. */
interface MachineRings {
  readonly cpu: ValueRing;
  readonly memory: ValueRing;
  readonly disk: ValueRing;
  readonly diskRead: ValueRing;
  readonly diskWrite: ValueRing;
  readonly cores: ValueRing[];
  readonly network: Map<string, { readonly send: ValueRing; readonly receive: ValueRing }>;
}

/** The rate of a counter that only grows, per second; `null` with nothing to compare. */
const rate = (now: number | null, before: number | null | undefined, elapsedMs: number): number | null =>
  now === null ? null : before === undefined || before === null || elapsedMs === 0 ? 0 : (Math.max(0, now - before) * 1000) / elapsedMs;

const sum = (values: readonly (number | null)[]): number | null =>
  values.reduce<number | null>((total, value) => (value === null ? total : (total ?? 0) + value), null);

const keyOf = (raw: RawProcess): string => `${raw.pid}:${raw.started === null ? 0 : Math.round(raw.started)}`;

/**
 * The backend machine's processes (PRD 014, §1): measured from the moment the
 * backend starts, whether anyone is looking or not — every `PROCESS_SAMPLE_MS`
 * while a client asks (Task Manager shown in a visible window), every
 * `PROCESS_IDLE_SAMPLE_MS` while none does (§4.1) — and the last ten minutes
 * kept — the machine's CPU, memory
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
  private readonly idleIntervalMs: number;
  /** When a client last asked: a client asking is one watching (PRD 014, §4.1). */
  private watchedAt = Number.NEGATIVE_INFINITY;
  /** When the next sample is due, while the timer runs. */
  private dueAt: number | null = null;
  /** When each kept sample was taken. */
  private readonly times = new ValueRing(PROCESS_HISTORY_SAMPLES);
  private readonly kill: (pid: number, signal: NodeJS.Signals | 0) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private busy = false;

  private sequence = 0;
  private at: number | null = null;
  private processes: readonly ProcessDto[] = [];
  private totals: ProcessTotalsDto = {
    cpu: 0,
    memoryUsed: 0,
    memoryTotal: totalmem(),
    disk: null,
    diskRead: null,
    diskWrite: null,
    processes: 0,
    threads: null,
    cores: [],
    network: [],
  };
  private failure: string | null = null;

  private seen = new Map<string, Seen>();
  private seenAt: number | null = null;
  /** Each logical processor's counters at the last sample. */
  private cpuTimes: CpuTimes[] | null = null;
  private adaptersSeen = new Map<string, RawAdapter>();
  private readonly machine: MachineRings = {
    cpu: new ValueRing(PROCESS_HISTORY_SAMPLES),
    memory: new ValueRing(PROCESS_HISTORY_SAMPLES),
    disk: new ValueRing(PROCESS_HISTORY_SAMPLES),
    diskRead: new ValueRing(PROCESS_HISTORY_SAMPLES),
    diskWrite: new ValueRing(PROCESS_HISTORY_SAMPLES),
    cores: [],
    network: new Map(),
  };
  private readonly history = new Map<string, SampleRing>();

  constructor(
    private readonly logger: Logger,
    private readonly options: ProcessesServiceOptions,
  ) {
    this.source = options.enabled ? (options.source ?? ProcessesService.sourceFor(process.platform, logger)) : null;
    this.intervalMs = options.intervalMs ?? PROCESS_SAMPLE_MS;
    this.idleIntervalMs = options.idleIntervalMs ?? PROCESS_IDLE_SAMPLE_MS;
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

  /**
   * Starts measuring, now and then at the pace of the moment (PRD 014,
   * §4.1): every `intervalMs` while someone watches, every `idleIntervalMs`
   * while no one does. Nothing when switched off.
   */
  start(): void {
    if (this.source === null || this.started) {
      return;
    }
    this.started = true;
    this.schedule(0);
  }

  close(): void {
    this.started = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dueAt = null;
    this.source?.close();
  }

  /** Whether a client asked within the lease: Task Manager is shown, in a window that is not hidden. */
  get watched(): boolean {
    return Date.now() - this.watchedAt < PROCESS_WATCH_LEASE_MS;
  }

  /** How often the processes are measured now. */
  get currentIntervalMs(): number {
    return this.watched ? this.intervalMs : this.idleIntervalMs;
  }

  /**
   * A client asked: someone is watching. Coming from the idle pace, the next
   * sample is taken at once rather than up to ten seconds later, and the
   * fast pace follows.
   */
  private watch(): void {
    const wasWatched = this.watched;
    this.watchedAt = Date.now();
    if (!wasWatched && this.started && this.dueAt !== null && this.dueAt - Date.now() > this.intervalMs) {
      this.schedule(0);
    }
  }

  private schedule(delay: number): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.dueAt = Date.now() + delay;
    this.timer = setTimeout(() => void this.tick(), delay);
    // Measuring never keeps the backend alive on its own.
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.dueAt = null;
    await this.sample();
    if (this.started && this.timer === null) {
      this.schedule(this.currentIntervalMs);
    }
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

  /** The latest sample; asking is watching (§4.1). */
  snapshot(): ProcessesSnapshotDto {
    this.watch();
    return {
      ...this.info(),
      sequence: this.sequence,
      at: this.at === null ? null : new Date(this.at).toISOString(),
      intervalMs: this.currentIntervalMs,
      platform: process.platform,
      cpuCount: Math.max(1, cpus().length),
      totals: this.totals,
      machine: ProcessesService.machineInfo(),
      processes: this.processes,
    };
  }

  /** The machine's last ten minutes, and those of each process named that is still running. */
  historyOf(keys: readonly string[]): ProcessesHistoryDto {
    this.watch();
    // Ten minutes, by the clock: at the idle pace the rings hold longer than that.
    const since = (this.at ?? Date.now()) - PROCESS_HISTORY_MS;
    const times = this.times.numbers().filter((time) => time > since);
    const last = times.length;
    const processes: Record<string, ReturnType<SampleRing['series']>> = {};
    for (const key of keys) {
      const ring = this.history.get(key);
      if (ring !== undefined) {
        processes[key] = ring.series(last);
      }
    }
    const machine = this.machine;
    const network: Record<string, { send: number[]; receive: number[] }> = {};
    for (const [name, rings] of machine.network) {
      network[name] = { send: rings.send.numbers(0, last), receive: rings.receive.numbers(0, last) };
    }
    return {
      intervalMs: this.currentIntervalMs,
      at: this.at === null ? null : new Date(this.at).toISOString(),
      times,
      totals: {
        cpu: machine.cpu.numbers(1, last),
        memory: machine.memory.numbers(0, last),
        disk: machine.disk.series(0, last),
        diskRead: machine.diskRead.series(0, last),
        diskWrite: machine.diskWrite.series(0, last),
        memoryTotal: this.totals.memoryTotal,
        cores: machine.cores.map((ring) => ring.numbers(1, last)),
        network,
      },
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
      const adapters = (await this.source.adapters?.().catch(() => [])) ?? [];
      this.record(raw, adapters, Date.now());
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

  private record(raw: readonly RawProcess[], adapters: readonly RawAdapter[], now: number): void {
    const elapsed = this.seenAt === null ? 0 : Math.max(1, now - this.seenAt);
    const cores = Math.max(1, cpus().length);
    const seen = new Map<string, Seen>();
    const processes: ProcessDto[] = [];
    let diskRead: number | null = null;
    let diskWrite: number | null = null;
    let threads: number | null = null;

    for (const entry of raw) {
      const key = keyOf(entry);
      const before = this.seen.get(key);
      seen.set(key, { cpuMs: entry.cpuMs, ioRead: entry.ioRead, ioWrite: entry.ioWrite });
      const cpu = before === undefined || elapsed === 0 ? 0 : Math.min(100, (Math.max(0, entry.cpuMs - before.cpuMs) / (elapsed * cores)) * 100);
      const read = rate(entry.ioRead, before?.ioRead, elapsed);
      const write = rate(entry.ioWrite, before?.ioWrite, elapsed);
      const disk = sum([read, write]);
      diskRead = sum([diskRead, read]);
      diskWrite = sum([diskWrite, write]);
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
        disk: disk === null ? null : Math.round(disk),
        threads: entry.threads,
        startedAt: entry.started === null ? null : new Date(entry.started).toISOString(),
      });

      let ring = this.history.get(key);
      if (ring === undefined) {
        ring = new SampleRing(PROCESS_HISTORY_SAMPLES);
        this.history.set(key, ring);
      }
      ring.push(cpu, entry.memory, disk);
    }
    // A process that has ended takes its history with it.
    for (const key of this.history.keys()) {
      if (!seen.has(key)) {
        this.history.delete(key);
      }
    }

    const total = totalmem();
    const used = total - freemem();
    const { overall, perCore } = this.machineCpu();
    const network = this.networkRates(adapters, elapsed);
    const disk = sum([diskRead, diskWrite]);
    const round = (value: number | null) => (value === null ? null : Math.round(value));
    this.totals = {
      cpu: Math.round(overall * 10) / 10,
      memoryUsed: used,
      memoryTotal: total,
      disk: round(disk),
      diskRead: round(diskRead),
      diskWrite: round(diskWrite),
      processes: processes.length,
      threads,
      cores: perCore.map((load) => Math.round(load * 10) / 10),
      network,
    };

    const machine = this.machine;
    this.times.push(now);
    machine.cpu.push(overall);
    machine.memory.push(used);
    machine.disk.push(disk);
    machine.diskRead.push(diskRead);
    machine.diskWrite.push(diskWrite);
    perCore.forEach((load, index) => {
      // A processor seen for the first time starts as long a history as the others, at nothing.
      if (machine.cores[index] === undefined) {
        const ring = new ValueRing(PROCESS_HISTORY_SAMPLES);
        for (let filled = 0; filled < machine.cpu.numbers().length - 1; filled += 1) {
          ring.push(0);
        }
        machine.cores[index] = ring;
      }
      machine.cores[index]?.push(load);
    });
    for (const adapter of network) {
      let rings = machine.network.get(adapter.name);
      if (rings === undefined) {
        rings = { send: new ValueRing(PROCESS_HISTORY_SAMPLES), receive: new ValueRing(PROCESS_HISTORY_SAMPLES) };
        machine.network.set(adapter.name, rings);
      }
      rings.send.push(adapter.send);
      rings.receive.push(adapter.receive);
    }
    // An adapter gone takes its graph with it.
    for (const name of machine.network.keys()) {
      if (!network.some((adapter) => adapter.name === name)) {
        machine.network.delete(name);
      }
    }

    this.processes = processes;
    this.seen = seen;
    this.seenAt = now;
    this.at = now;
    this.sequence += 1;
  }

  /** Each adapter's bytes a second since the last sample. */
  private networkRates(adapters: readonly RawAdapter[], elapsed: number): NetworkAdapterDto[] {
    const rates = adapters.map((adapter) => {
      const before = this.adaptersSeen.get(adapter.name);
      return {
        name: adapter.name,
        send: Math.round(rate(adapter.sent, before?.sent, elapsed) ?? 0),
        receive: Math.round(rate(adapter.received, before?.received, elapsed) ?? 0),
      };
    });
    this.adaptersSeen = new Map(adapters.map((adapter) => [adapter.name, adapter]));
    return rates;
  }

  /**
   * The machine's CPU since the last sample, 0–100 — all of it, and each
   * logical processor — from the operating system's own counters.
   */
  private machineCpu(): { readonly overall: number; readonly perCore: number[] } {
    const now = cpus().map((cpu) => ({
      idle: cpu.times.idle,
      total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle,
    }));
    const before = this.cpuTimes;
    this.cpuTimes = now;
    const load = (current: CpuTimes, previous: CpuTimes | undefined): number =>
      previous === undefined || current.total <= previous.total
        ? 0
        : Math.min(100, Math.max(0, (1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100));
    const perCore = now.map((times, index) => load(times, before?.[index]));
    const idle = now.reduce((total, times) => total + times.idle, 0);
    const total = now.reduce((all, times) => all + times.total, 0);
    const overall =
      before === null
        ? 0
        : load({ idle, total }, { idle: before.reduce((all, times) => all + times.idle, 0), total: before.reduce((all, times) => all + times.total, 0) });
    return { overall, perCore };
  }

  /** What the CPU is, how fast it runs now, and how long the machine has been up. */
  private static machineInfo(): MachineInfoDto {
    const first = cpus()[0];
    return {
      cpuModel: first?.model.trim() ?? '',
      cpuSpeedMhz: first?.speed ?? 0,
      uptimeSeconds: Math.round(uptime()),
      hostname: hostname(),
    };
  }
}
