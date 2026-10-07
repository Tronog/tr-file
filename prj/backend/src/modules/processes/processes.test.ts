import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import { PROCESS_HISTORY_SAMPLES, type ProcessSource, type RawAdapter, type RawProcess } from './processes.model.js';
import { ProcessesService } from './processes.service.js';
import { LinuxProcessSource } from './sources/linux-process-source.js';

/** PRD 014, §1 — the backend machine's processes, measured every two seconds. */

const raw = (pid: number, patch: Partial<RawProcess> = {}): RawProcess => ({
  pid,
  ppid: 1,
  name: `p${pid}`,
  path: `/usr/bin/p${pid}`,
  command: `p${pid} --flag`,
  user: 'someone',
  title: null,
  status: 'sleeping',
  category: 'background',
  cpuMs: 0,
  memory: 1024,
  ioRead: 0,
  ioWrite: 0,
  threads: 1,
  started: 1_000_000 + pid,
  ...patch,
});

/** A machine that says whatever the test last told it. */
class FakeSource implements ProcessSource {
  processes: RawProcess[] = [];
  network: RawAdapter[] = [];
  closed = false;
  async sample(): Promise<readonly RawProcess[]> {
    return this.processes;
  }
  async adapters(): Promise<readonly RawAdapter[]> {
    return this.network;
  }
  close(): void {
    this.closed = true;
  }
}

const logger = Logger.create('error');

/** Two samples `ms` apart, by moving the clock rather than waiting. */
async function twoSamples(
  service: ProcessesService,
  source: FakeSource,
  first: RawProcess[],
  second: RawProcess[],
  ms = 2000,
  network: [RawAdapter[], RawAdapter[]] = [[], []],
): Promise<void> {
  const realNow = Date.now;
  const start = realNow();
  try {
    Date.now = () => start;
    source.processes = first;
    source.network = network[0];
    await service.sample();
    Date.now = () => start + ms;
    source.processes = second;
    source.network = network[1];
    await service.sample();
  } finally {
    Date.now = realNow;
  }
}

describe('ProcessesService', () => {
  it('turns growing counters into rates: CPU as a share of every core, disk as bytes a second', async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, { enabled: true, canEnd: false, source });
    const cores = service.snapshot().cpuCount;
    // 1000 ms of CPU in 2000 ms on every core is 50 % of one core: 50 / cores of the machine.
    await twoSamples(service, source, [raw(10, { cpuMs: 5000, ioRead: 100 })], [raw(10, { cpuMs: 6000, ioRead: 3100, ioWrite: 1000 })]);
    const snapshot = service.snapshot();
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.sequence, 2);
    const process = snapshot.processes[0];
    assert.equal(process?.key, '10:1000010');
    assert.equal(process?.cpu, Math.round((50 / cores) * 10) / 10);
    assert.equal(process?.disk, 2000);
    assert.equal(snapshot.totals.processes, 1);
    assert.equal(snapshot.totals.disk, 2000);
    assert.equal(snapshot.totals.diskRead, 1500);
    assert.equal(snapshot.totals.diskWrite, 500);
    assert.ok(snapshot.totals.memoryTotal > 0);
  });

  it('shows a process new to it as idle, and a disk it may not see as unknown', async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, { enabled: true, canEnd: false, source });
    await twoSamples(service, source, [], [raw(11, { cpuMs: 99_999, ioRead: null, ioWrite: null })]);
    const process = service.snapshot().processes[0];
    assert.equal(process?.cpu, 0);
    assert.equal(process?.disk, null);
    assert.equal(service.snapshot().totals.disk, null);
  });

  it('never takes a pid handed out again for the process before it', async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, { enabled: true, canEnd: false, source });
    await twoSamples(service, source, [raw(12, { cpuMs: 1000 })], [raw(12, { cpuMs: 9000, started: 5_000_000 })]);
    const process = service.snapshot().processes[0];
    assert.equal(process?.key, '12:5000000');
    assert.equal(process?.cpu, 0);
    // The first one's history went with it.
    assert.deepEqual(Object.keys(service.historyOf(['12:1000012', '12:5000000']).processes), ['12:5000000']);
  });

  it(`keeps the last ${PROCESS_HISTORY_SAMPLES} samples of the machine and of each process still running`, async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, { enabled: true, canEnd: false, source });
    source.processes = [raw(13, { memory: 7 })];
    for (let index = 0; index < PROCESS_HISTORY_SAMPLES + 5; index += 1) {
      await service.sample();
    }
    const history = service.historyOf(['13:1000013', '999:1']);
    assert.equal(history.totals.cpu.length, PROCESS_HISTORY_SAMPLES);
    assert.equal(history.processes['13:1000013']?.memory.length, PROCESS_HISTORY_SAMPLES);
    assert.equal(history.processes['13:1000013']?.memory.at(-1), 7);
    assert.equal(history.processes['999:1'], undefined);
  });

  it('measures each network adapter, and keeps the machine’s graphs: CPU per processor, disk read and written (§2.1)', async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, { enabled: true, canEnd: false, source });
    await twoSamples(service, source, [], [], 2000, [
      [{ name: 'eth0', received: 1000, sent: 0 }],
      [
        { name: 'eth0', received: 5000, sent: 2000 },
        { name: 'wlan0', received: 10, sent: 10 },
      ],
    ]);
    const snapshot = service.snapshot();
    assert.deepEqual(snapshot.totals.network, [
      { name: 'eth0', send: 1000, receive: 2000 },
      // Seen for the first time: nothing to compare with yet.
      { name: 'wlan0', send: 0, receive: 0 },
    ]);
    assert.equal(snapshot.totals.cores.length, snapshot.cpuCount);
    assert.ok(snapshot.machine.uptimeSeconds > 0);

    const history = service.historyOf([]).totals;
    assert.equal(history.cpu.length, 2);
    assert.equal(history.cores.length, snapshot.cpuCount);
    assert.ok(history.cores.every((series) => series.length === 2));
    assert.deepEqual(history.network['eth0'], { send: [0, 1000], receive: [0, 2000] });
    assert.deepEqual(history.network['wlan0'], { send: [0], receive: [0] });
    assert.equal(history.diskRead.length, 2);

    // An adapter gone takes its graph with it.
    source.network = [{ name: 'eth0', received: 5000, sent: 2000 }];
    await service.sample();
    assert.deepEqual(Object.keys(service.historyOf([]).totals.network), ['eth0']);
  });

  it('ends a process by its key, and a tree youngest first — asking first, then making it', async () => {
    const source = new FakeSource();
    const signals: [number, string | number][] = [];
    const service = new ProcessesService(logger, {
      enabled: true,
      canEnd: true,
      source,
      kill: (pid, signal) => {
        signals.push([pid, signal]);
      },
    });
    source.processes = [
      raw(20),
      raw(21, { ppid: 20 }),
      raw(22, { ppid: 21 }),
      // Its pid's parent is 20, but it started before 20 did: a reused pid, no child of it.
      raw(23, { ppid: 20, started: 1 }),
    ];
    await service.sample();
    assert.deepEqual(await service.end({ key: '20:1000020', tree: true }), { ended: [22, 21, 20], failed: [] });
    assert.deepEqual(
      signals.map(([pid]) => pid),
      [22, 21, 20],
    );
    assert.ok(signals.every(([, signal]) => signal === 'SIGTERM'));
    await assert.rejects(service.end({ key: '20:123' }), /already ended/);
  });

  it('says why a process could not be ended', async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, {
      enabled: true,
      canEnd: true,
      source,
      kill: () => {
        throw Object.assign(new Error('nope'), { code: 'EPERM' });
      },
    });
    source.processes = [raw(30)];
    await service.sample();
    await assert.rejects(service.end({ key: '30:1000030' }), /Access is denied/);
  });

  it('never ends tr-file itself', async () => {
    const source = new FakeSource();
    const service = new ProcessesService(logger, { enabled: true, canEnd: true, source, kill: () => undefined });
    source.processes = [raw(process.pid)];
    await service.sample();
    await assert.rejects(service.end({ key: `${process.pid}:${1_000_000 + process.pid}` }), /tr-file itself/);
  });

  it('measures nothing switched off, and ends nothing unless allowed', async () => {
    const source = new FakeSource();
    source.processes = [raw(40)];
    const off = new ProcessesService(logger, { enabled: false, canEnd: true, source });
    await off.sample();
    assert.equal(off.snapshot().available, false);
    assert.match(off.snapshot().reason ?? '', /PROCESSES_ENABLED/);
    assert.deepEqual(off.snapshot().processes, []);

    const readOnly = new ProcessesService(logger, { enabled: true, canEnd: false, source });
    await readOnly.sample();
    assert.equal(readOnly.snapshot().canEnd, false);
    assert.match(readOnly.snapshot().endReason ?? '', /PROCESSES_KILL_ENABLED/);
    await assert.rejects(readOnly.end({ key: '40:1000040' }), /switched off/);
  });

  it('says when the machine could not be measured, and recovers', async () => {
    const source = new FakeSource();
    let fail = true;
    source.sample = async () => {
      if (fail) {
        throw new Error('no /proc');
      }
      return [raw(50)];
    };
    const service = new ProcessesService(logger, { enabled: true, canEnd: true, source });
    await service.sample();
    assert.equal(service.snapshot().available, false);
    assert.match(service.snapshot().reason ?? '', /no \/proc/);
    assert.equal(service.snapshot().canEnd, false);
    fail = false;
    await service.sample();
    assert.equal(service.snapshot().available, true);
  });
});

describe('LinuxProcessSource', { skip: process.platform !== 'linux' }, () => {
  it('reads /proc: this very process, with its CPU time, memory and threads', async () => {
    const source = new LinuxProcessSource();
    const processes = await source.sample();
    const self = processes.find((entry) => entry.pid === process.pid);
    assert.ok(self !== undefined);
    assert.equal(self.ppid, process.ppid);
    assert.ok(self.cpuMs > 0);
    assert.ok(self.memory > 0);
    assert.ok((self.threads ?? 0) >= 1);
    assert.ok(self.started !== null && self.started <= Date.now());
    // Our own process's bytes are ours to see.
    assert.notEqual(self.ioRead, null);
    assert.notEqual(self.ioWrite, null);
    assert.match(self.command ?? '', /node|tsx/);
  });

  it('reads a process whose name holds spaces and brackets, and says it is suspended', async () => {
    const proc = await mkdtemp(join(tmpdir(), 'tr-file-proc-'));
    try {
      await writeFile(join(proc, 'stat'), 'cpu 1 2 3\nbtime 1700000000\n');
      await mkdir(join(proc, '77'));
      // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime prio nice threads itreal starttime …
      await writeFile(join(proc, '77', 'stat'), '77 (a (weird) name) T 1 77 77 0 -1 0 0 0 0 0 150 50 0 0 20 0 3 0 500 0 0\n');
      await writeFile(join(proc, '77', 'status'), 'Name:\tx\nUid:\t0\t0\t0\t0\nVmRSS:\t   2048 kB\nRssAnon:\t   1024 kB\n');
      await writeFile(join(proc, '77', 'io'), 'rchar: 1\nread_bytes: 4096\nwrite_bytes: 1024\n');
      await writeFile(join(proc, '77', 'cmdline'), 'weird\0--now\0');
      await writeFile(join(proc, '77', 'cgroup'), '0::/system.slice/weird.service\n');
      const [entry] = await new LinuxProcessSource(proc, 1000).sample();
      assert.equal(entry?.name, 'a (weird) name');
      assert.equal(entry?.status, 'suspended');
      assert.equal(entry?.cpuMs, 2000);
      assert.equal(entry?.threads, 3);
      assert.equal(entry?.memory, 1024 * 1024);
      assert.equal(entry?.ioRead, 4096);
      assert.equal(entry?.ioWrite, 1024);
      assert.equal(entry?.command, 'weird --now');
      assert.equal(entry?.started, 1_700_000_000_000 + 5000);
      assert.equal(entry?.category, 'system');

      await mkdir(join(proc, 'net'));
      await writeFile(
        join(proc, 'net', 'dev'),
        'Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets\n' +
          '    lo: 900 1 0 0 0 0 0 0 900 1 0 0 0 0 0 0\n' +
          'veth9z: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0\n',
      );
      // No device among them (a container's): all but the loopback.
      assert.deepEqual(await new LinuxProcessSource(proc, 1000).adapters(), [{ name: 'veth9z', received: 100, sent: 200 }]);
    } finally {
      await rm(proc, { recursive: true, force: true });
    }
  });
});

describe('/api/processes and the bridge', () => {
  const source = new FakeSource();
  source.processes = [raw(60, { category: 'app', title: 'Sixty' })];
  const app = new App(AppConfig.fromEnv({ FILES_ROOT: tmpdir(), NODE_ENV: 'test' }), logger, '0.0.0-test', { processes: source });
  let server: Server | null = null;

  after(() => {
    server?.close();
    app.close();
  });

  const url = async (path: string): Promise<string> => {
    server ??= app.instance.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => (server?.listening ? resolve() : server?.once('listening', () => resolve())));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/processes${path}`;
  };

  it('lists the latest sample, and the history of the processes named', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const list = (await (await fetch(await url(''))).json()) as { data: { processes: { key: string; title: string }[] } };
    assert.deepEqual(
      list.data.processes.map((entry) => [entry.key, entry.title]),
      [['60:1000060', 'Sixty']],
    );
    const history = (await (await fetch(await url('/history?keys=60:1000060'))).json()) as { data: { processes: Record<string, unknown> } };
    assert.deepEqual(Object.keys(history.data.processes), ['60:1000060']);
  });

  it('refuses an end that does not name a process, or comes from another site', async () => {
    const bad = await fetch(await url('/end'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tr-file-request': '1' },
      body: JSON.stringify({ key: '60; rm -rf /' }),
    });
    assert.equal(bad.status, 400);
    const forged = await fetch(await url('/end'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"key":"60:1000060"}' });
    assert.equal(forged.status, 403);
  });

  it('answers the same over the bridge', async () => {
    const list = await app.bridge.dispatch({ command: 'proc-list' });
    assert.ok('data' in list);
    assert.equal((list.data as { processes: unknown[] }).processes.length, 1);
    const history = await app.bridge.dispatch({ command: 'proc-history', keys: ['60:1000060'] });
    assert.ok('data' in history);
    const bad = await app.bridge.dispatch({ command: 'proc-end', key: 42 });
    assert.ok('error' in bad);
    assert.equal(bad.error.status, 400);
    const gone = await app.bridge.dispatch({ command: 'proc-end', key: '61:1' });
    assert.ok('error' in gone);
    assert.equal(gone.error.status, 404);
  });
});
