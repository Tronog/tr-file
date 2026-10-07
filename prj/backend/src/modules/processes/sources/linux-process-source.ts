import { access, readFile, readdir, readlink } from 'node:fs/promises';
import { basename } from 'node:path';

import type { ProcessCategory, ProcessSource, ProcessStatus, RawAdapter, RawProcess } from '../processes.model.js';

/** Clock ticks per second of `/proc/<pid>/stat`'s times: 100 on every Linux there is. */
const CLOCK_TICKS = 100;

/** How long the account names of `/etc/passwd` are believed. */
const PASSWD_TTL_MS = 60_000;

/** What does not change in a process's life, read once. */
interface Fixed {
  readonly path: string | null;
  readonly command: string | null;
  readonly user: string | null;
  readonly uid: number | null;
  /** Started by the desktop as an app: its control group is systemd's `app-….scope` (or `app-…@….service`). */
  readonly desktopApp: boolean;
}

/** The last segment of a control group systemd puts a launched desktop app in. */
const APP_UNIT = /\/app-[^/]*(?:\.scope|@[^/]*\.service)$/;

const STATES: Readonly<Record<string, ProcessStatus>> = {
  R: 'running',
  S: 'sleeping',
  D: 'waiting',
  T: 'suspended',
  t: 'suspended',
  Z: 'zombie',
  X: 'zombie',
  I: 'idle',
};

/**
 * Every process of a Linux machine, from `/proc` (PRD 014, §1): `stat` for its
 * parent, state, CPU time, threads and start, `status` for its owner and
 * memory, `io` for the bytes it has moved — which only its owner (or root)
 * may read, so another account's disk is `null`.
 *
 * Memory is `RssAnon`: what is resident and the process's alone, nearest to
 * Task Manager's private working set. The executable, the command line and
 * the owner are read once per process.
 *
 * *Apps* are what the account the backend runs as has launched from its
 * desktop: systemd puts each in a unit of its own, `app-<launcher>-<id>.scope`,
 * which tells them from that account's services. Where there is no such
 * desktop (a container, a server) they are the processes leading a session of
 * that account. Root's processes and the kernel's threads are the system's;
 * the rest run in the background.
 */
export class LinuxProcessSource implements ProcessSource {
  private readonly fixed = new Map<string, Fixed>();
  private users: { readonly names: Map<number, string>; readonly at: number } | null = null;
  private bootMs: number | null = null;
  /** Whether an adapter is a device's (`/sys/class/net/<name>/device`), not a bridge or a container's end. */
  private readonly physical = new Map<string, boolean>();

  constructor(
    private readonly proc = '/proc',
    private readonly self: number | null = typeof process.getuid === 'function' ? process.getuid() : null,
  ) {}

  async sample(): Promise<readonly RawProcess[]> {
    const [names, boot, entries] = await Promise.all([this.userNames(), this.boot(), readdir(this.proc)]);
    const pids = entries.filter((entry) => /^\d+$/.test(entry)).map(Number);
    const read = await Promise.all(pids.map((pid) => this.read(pid, boot, names)));
    const alive = read.filter((entry): entry is Read => entry !== null);

    // A desktop that launches apps as units of their own says which they are; without one, sessions do.
    const desktop = alive.some((entry) => entry.desktopApp && entry.uid === this.self);
    const seen = new Set<string>();
    const processes = alive.map((entry) => {
      seen.add(entry.fixedKey);
      return { ...entry.raw, category: this.category(entry, desktop) };
    });
    for (const key of this.fixed.keys()) {
      if (!seen.has(key)) {
        this.fixed.delete(key);
      }
    }
    return processes;
  }

  close(): void {
    this.fixed.clear();
  }

  /**
   * The network adapters' bytes so far, from `/proc/net/dev` — the devices'
   * own when there are any, as Task Manager lists the adapters; a
   * container's (none of them a device) all but the loopback.
   */
  async adapters(): Promise<readonly RawAdapter[]> {
    const dev = await readFile(`${this.proc}/net/dev`, 'utf8').catch(() => '');
    const all: RawAdapter[] = [];
    for (const line of dev.split('\n').slice(2)) {
      const colon = line.indexOf(':');
      if (colon < 0) {
        continue;
      }
      const name = line.slice(0, colon).trim();
      const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
      // receive: bytes packets errs drop fifo frame compressed multicast; then transmit: bytes …
      const received = fields[0];
      const sent = fields[8];
      if (name !== 'lo' && received !== undefined && sent !== undefined && Number.isFinite(received) && Number.isFinite(sent)) {
        all.push({ name, received, sent });
      }
    }
    const devices = await Promise.all(all.map((adapter) => this.isDevice(adapter.name)));
    const physical = all.filter((_, index) => devices[index]);
    return physical.length > 0 ? physical : all;
  }

  private async isDevice(name: string): Promise<boolean> {
    let known = this.physical.get(name);
    if (known === undefined) {
      known = await access(`/sys/class/net/${name}/device`).then(
        () => true,
        () => false,
      );
      this.physical.set(name, known);
    }
    return known;
  }

  private category(entry: Read, desktop: boolean): ProcessCategory {
    if (entry.kernel) {
      return 'system';
    }
    if (this.self !== null && entry.uid === this.self && (desktop ? entry.desktopApp : entry.leader)) {
      return 'app';
    }
    return entry.uid === 0 ? 'system' : 'background';
  }

  private async read(pid: number, boot: number, names: ReadonlyMap<number, string>): Promise<Read | null> {
    const dir = `${this.proc}/${pid}`;
    let stat: string;
    let status: string;
    try {
      [stat, status] = await Promise.all([readFile(`${dir}/stat`, 'utf8'), readFile(`${dir}/status`, 'utf8')]);
    } catch {
      // Gone between the listing and the read.
      return null;
    }
    // `pid (comm) S ppid …` — the name may hold spaces and brackets, so the fields start after the last `)`.
    const open = stat.indexOf('(');
    const close = stat.lastIndexOf(')');
    if (open < 0 || close < open) {
      return null;
    }
    const comm = stat.slice(open + 1, close);
    const fields = stat.slice(close + 2).split(' ');
    const state = fields[0] ?? 'S';
    const ppid = Number(fields[1]);
    const session = Number(fields[3]);
    const cpuTicks = Number(fields[11]) + Number(fields[12]);
    const threads = Number(fields[17]);
    const startTicks = Number(fields[19]);
    const started = Number.isFinite(startTicks) ? boot + (startTicks * 1000) / CLOCK_TICKS : null;
    const kernel = pid === 2 || ppid === 2;

    const uid = LinuxProcessSource.field(status, 'Uid');
    const owner = uid === null ? null : Number(uid.split(/\s+/)[0]);
    const anon = LinuxProcessSource.kilobytes(status, 'RssAnon') ?? LinuxProcessSource.kilobytes(status, 'VmRSS') ?? 0;

    const fixedKey = `${pid}:${startTicks}`;
    let fixed = this.fixed.get(fixedKey);
    if (fixed === undefined) {
      fixed = kernel
        ? { path: null, command: null, user: owner === null ? null : (names.get(owner) ?? String(owner)), uid: owner, desktopApp: false }
        : await this.readFixed(dir, owner, names);
      this.fixed.set(fixedKey, fixed);
    }

    const io = kernel ? null : await LinuxProcessSource.io(dir);
    const name = fixed.path === null ? comm : basename(fixed.path);
    return {
      fixedKey,
      uid: owner,
      kernel,
      leader: session === pid,
      desktopApp: fixed.desktopApp,
      raw: {
        pid,
        ppid: Number.isFinite(ppid) ? ppid : 0,
        name,
        path: fixed.path,
        command: fixed.command,
        user: fixed.user,
        title: null,
        status: STATES[state] ?? 'running',
        category: 'background',
        cpuMs: Number.isFinite(cpuTicks) ? (cpuTicks * 1000) / CLOCK_TICKS : 0,
        memory: anon,
        ioRead: io?.read ?? null,
        ioWrite: io?.write ?? null,
        threads: Number.isFinite(threads) ? threads : null,
        started,
      },
    };
  }

  private async readFixed(dir: string, uid: number | null, names: ReadonlyMap<number, string>): Promise<Fixed> {
    const [exe, cmdline, cgroup] = await Promise.all([
      readlink(`${dir}/exe`).catch(() => null),
      readFile(`${dir}/cmdline`).catch(() => null),
      readFile(`${dir}/cgroup`, 'utf8').catch(() => ''),
    ]);
    const args = cmdline === null ? [] : cmdline.toString('utf8').split('\0').filter((arg) => arg !== '');
    // A program replaced on disk while running reads `/usr/bin/x (deleted)`.
    const path = exe?.replace(/ \(deleted\)$/, '') ?? (args[0]?.startsWith('/') ? args[0] : null);
    return {
      path,
      command: args.length === 0 ? null : args.join(' '),
      user: uid === null ? null : (names.get(uid) ?? String(uid)),
      uid,
      desktopApp: cgroup.split('\n').some((line) => APP_UNIT.test(line)),
    };
  }

  /** Bytes the process has had read from and written to storage; `null` when it is not ours to see. */
  private static async io(dir: string): Promise<{ readonly read: number; readonly write: number } | null> {
    try {
      const io = await readFile(`${dir}/io`, 'utf8');
      const read = /^read_bytes:\s*(\d+)/m.exec(io);
      const write = /^write_bytes:\s*(\d+)/m.exec(io);
      return read === null || write === null ? null : { read: Number(read[1]), write: Number(write[1]) };
    } catch {
      return null;
    }
  }

  /** When the machine started, ms since the epoch — the zero of every start time. */
  private async boot(): Promise<number> {
    if (this.bootMs === null) {
      const stat = await readFile(`${this.proc}/stat`, 'utf8').catch(() => '');
      const btime = /^btime\s+(\d+)/m.exec(stat);
      this.bootMs = btime === null ? 0 : Number(btime[1]) * 1000;
    }
    return this.bootMs;
  }

  private async userNames(): Promise<ReadonlyMap<number, string>> {
    if (this.users !== null && Date.now() - this.users.at < PASSWD_TTL_MS) {
      return this.users.names;
    }
    const names = new Map<number, string>();
    const passwd = await readFile('/etc/passwd', 'utf8').catch(() => '');
    for (const line of passwd.split('\n')) {
      const [name, , uid] = line.split(':');
      if (name !== undefined && name !== '' && uid !== undefined && /^\d+$/.test(uid)) {
        names.set(Number(uid), name);
      }
    }
    this.users = { names, at: Date.now() };
    return names;
  }

  private static field(status: string, name: string): string | null {
    const match = new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(status);
    return match?.[1]?.trim() ?? null;
  }

  private static kilobytes(status: string, name: string): number | null {
    const value = LinuxProcessSource.field(status, name);
    const kb = value === null ? NaN : Number.parseInt(value, 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  }
}

/** One process read, with what deciding its heading needs. */
interface Read {
  readonly raw: RawProcess;
  readonly fixedKey: string;
  readonly uid: number | null;
  readonly kernel: boolean;
  /** It leads its session (`pid` is its session id). */
  readonly leader: boolean;
  readonly desktopApp: boolean;
}
