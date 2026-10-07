import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsProcess, FsProcessesSnapshot } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { WorkbenchService } from '../workbench.service';
import { TASK_MANAGER_KEY, TASK_MANAGER_POLL_MS } from './task-manager.feature';

/** PRD 014, §2 — Task Manager's *Processes*, as Windows 10 shows them. */

const process = (pid: number, patch: Partial<FsProcess> = {}): FsProcess => ({
  pid,
  ppid: 1,
  key: `${pid}:1`,
  name: `p${pid}`,
  path: `/usr/bin/p${pid}`,
  command: `p${pid}`,
  user: 'ana',
  title: null,
  status: 'sleeping',
  category: 'background',
  cpu: 0,
  memory: 1024 * 1024,
  disk: 0,
  threads: 1,
  startedAt: null,
  ...patch,
});

const snapshot = (processes: FsProcess[], patch: Partial<FsProcessesSnapshot> = {}): FsProcessesSnapshot => ({
  available: true,
  reason: null,
  canEnd: true,
  endReason: null,
  sequence: 1,
  at: '2026-10-07T10:00:00Z',
  intervalMs: TASK_MANAGER_POLL_MS,
  platform: 'linux',
  cpuCount: 4,
  totals: {
    cpu: 12.4,
    memoryUsed: 4 * 2 ** 30,
    memoryTotal: 8 * 2 ** 30,
    disk: 0,
    diskRead: 0,
    diskWrite: 0,
    processes: processes.length,
    threads: processes.length,
    cores: [10, 15],
    network: [{ name: 'eth0', send: 1000, receive: 125_000 }],
  },
  machine: { cpuModel: 'Test CPU', cpuSpeedMhz: 2300, uptimeSeconds: 90_061, hostname: 'box' },
  processes,
  ...patch,
});

describe('TaskManagerFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.removeItem(TASK_MANAGER_KEY);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  afterEach(() => {
    tm().stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem(TASK_MANAGER_KEY);
  });

  const tm = () => workbench.taskManagerFt;
  const answer = (value: FsProcessesSnapshot) => vi.spyOn(workbench.fileSystem.processesFt, 'list').mockResolvedValue(value);

  /** Shows Task Manager and lets the first answer land. */
  async function open(): Promise<void> {
    tm().start();
    workbench.subAppsFt.show('task-manager');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  }

  const rows = () => tm().model().rows.map((row) => `${'  '.repeat(row.level)}${row.label}${row.detail ? ` ${row.detail}` : ''}`);

  it('asks for nothing until shown, then every two seconds while shown and not paused', async () => {
    const list = answer(snapshot([process(1)]));
    tm().start();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(list).not.toHaveBeenCalled();

    workbench.subAppsFt.show('task-manager');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TASK_MANAGER_POLL_MS);
    expect(list).toHaveBeenCalledTimes(2);

    tm().togglePause();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(list).toHaveBeenCalledTimes(2);
    expect(tm().model().paused).toBe(true);

    tm().togglePause();
    workbench.subAppsFt.show('file-manager');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('lists an app’s processes under one row, under Apps, Background and System processes', async () => {
    answer(
      snapshot([
        process(10, { name: 'chrome', path: '/opt/chrome', category: 'app', cpu: 2 }),
        process(11, { name: 'chrome', path: '/opt/chrome', category: 'background', ppid: 10, cpu: 1.5, title: 'Inbox' }),
        process(20, { name: 'sshd', category: 'system' }),
        process(30, { name: 'cron' }),
      ]),
    );
    await open();
    expect(rows()).toEqual(['Apps (1)', '  chrome (2)', 'Background processes (1)', '  cron', 'System processes (1)', '  sshd']);
    const chrome = tm().model().rows[1];
    expect(chrome?.cells['cpu']?.text).toBe('3.5%');
    expect(tm().model().columns.find((column) => column.id === 'cpu')?.total).toBe('12%');

    tm().toggle('g:chrome');
    expect(rows().slice(0, 4)).toEqual(['Apps (1)', '  chrome (2)', '    chrome', '    chrome Inbox']);
  });

  it('sorts by a column clicked — a number largest first — and remembers it, and the columns', async () => {
    answer(snapshot([process(1, { name: 'a', cpu: 1 }), process(2, { name: 'b', cpu: 9 }), process(3, { name: 'c', cpu: 5 })]));
    await open();
    tm().sort('cpu');
    expect(rows().slice(1)).toEqual(['  b', '  c', '  a']);
    tm().sort('cpu');
    expect(rows().slice(1)).toEqual(['  a', '  c', '  b']);

    tm().toggleColumn('pid');
    expect(tm().model().columns.map((column) => column.id)).toEqual(['name', 'status', 'pid', 'cpu', 'memory', 'disk']);
    expect(JSON.parse(localStorage.getItem(TASK_MANAGER_KEY) ?? 'null')).toEqual({
      columns: ['name', 'status', 'cpu', 'memory', 'disk', 'pid'],
      sort: { column: 'cpu', direction: 'asc' },
      view: 'processes',
      span: '60s',
      cpuView: 'overall',
    });
  });

  it('filters by name, title, pid, user or command line', async () => {
    answer(snapshot([process(1, { name: 'alpha' }), process(2, { name: 'beta', title: 'Report.docx' }), process(3, { name: 'gamma' })]));
    await open();
    tm().setFilter('report');
    expect(rows()).toEqual(['Background processes (1)', '  beta Report.docx']);
    expect(tm().model().summary).toBe('1 of 3 processes');
    tm().setFilter('nothing');
    expect(tm().model().empty?.title).toBe("No process matches 'nothing'");
  });

  it('ends the process selected by its key, and asks first for a tree or a system process', async () => {
    answer(snapshot([process(5), process(6, { category: 'system' })]));
    await open();
    const end = vi.spyOn(workbench.fileSystem.processesFt, 'end').mockResolvedValue({ ended: [5], failed: [] });
    const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);

    tm().select('p:5:1');
    workbench.commandsFt.run('process.endTask');
    await vi.advanceTimersByTimeAsync(0);
    expect(end).toHaveBeenCalledWith('5:1', false);
    expect(confirm).not.toHaveBeenCalled();

    workbench.commandsFt.run('process.endTree');
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenLastCalledWith('5:1', true);

    tm().select('p:6:1');
    confirm.mockResolvedValue(false);
    workbench.commandsFt.run('process.endTask');
    await vi.advanceTimersByTimeAsync(0);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it('says why a process could not be ended', async () => {
    answer(snapshot([process(5)]));
    await open();
    vi.spyOn(workbench.fileSystem.processesFt, 'end').mockRejectedValue(new FsError('Access is denied.', 403, 'FORBIDDEN'));
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
    tm().select('p:5:1');
    await tm().endSelected(false);
    expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: "Could not end 'p5'.", detail: 'Access is denied.' }));
  });

  it('offers no End task where the backend allows none, and says why', async () => {
    answer(snapshot([process(5)], { canEnd: false, endReason: 'Ending processes is switched off on this server (PROCESSES_KILL_ENABLED).' }));
    await open();
    tm().select('p:5:1');
    expect(tm().model().canEnd).toBe(false);
    expect(tm().model().endTitle).toMatch(/PROCESSES_KILL_ENABLED/);
    expect(workbench.commandsFt.isEnabled('process.endTask')).toBe(false);
  });

  it('says when the processes are not measured here', async () => {
    answer(snapshot([], { available: false, reason: 'Processes are switched off on this server (PROCESSES_ENABLED).' }));
    await open();
    expect(tm().model().empty).toMatchObject({ title: 'Task Manager is not available here', hint: expect.stringMatching(/PROCESSES_ENABLED/) });
  });

  it('puts the machine’s load in the status bar while shown, and pauses from there', async () => {
    answer(snapshot([process(1)]));
    await open();
    const labels = () => workbench.chromeFt.statusTrailingItems().map((item) => item.label);
    expect(labels()).toEqual(['Processes: 1', 'CPU: 12%', 'Memory: 50%', 'Updating every 2 s']);
    workbench.chromeFt.runStatusAction('tm-pause');
    expect(labels().at(-1)).toBe('Updates paused');
    workbench.subAppsFt.show('file-manager');
    expect(labels()).not.toContain('Updates paused');
  });

  it('is shown by Ctrl+Shift+T from anywhere, with the keyboard on its list (§3)', () => {
    answer(snapshot([process(1)]));
    expect(workbench.subAppsFt.active()).toBe('file-manager');
    const before = tm().focusToken();
    const event = new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, cancelable: true });
    workbench.keybindingsFt.handleShortcut(event);
    expect(workbench.subAppsFt.active()).toBe('task-manager');
    expect(event.defaultPrevented).toBe(true);
    expect(tm().focusToken()).toBe(before + 1);
    expect(workbench.keybindingsFt.label('view.app.task-manager')).toBe('Ctrl+Shift+T');
  });

  it('asks for the machine’s history only while the Graph tab is shown, and draws its pages from it (§2.1)', async () => {
    answer(snapshot([process(1)]));
    const history = vi.spyOn(workbench.fileSystem.processesFt, 'history').mockResolvedValue({
      intervalMs: TASK_MANAGER_POLL_MS,
      at: null,
      // Ten seconds apart while no one watched, then two (§4.1).
      times: [1_000_000, 1_010_000],
      totals: {
        cpu: [10, 50],
        memory: [2 ** 30, 2 * 2 ** 30],
        disk: [0, 0],
        memoryTotal: 8 * 2 ** 30,
        diskRead: [0, 0],
        diskWrite: [0, 0],
        cores: [
          [5, 40],
          [15, 60],
        ],
        network: { eth0: { send: [0, 1000], receive: [0, 125_000] } },
      },
      processes: {},
    });
    await open();
    expect(history).not.toHaveBeenCalled();

    workbench.commandsFt.run('process.showGraph');
    await vi.advanceTimersByTimeAsync(0);
    expect(tm().view()).toBe('graph');
    expect(history).toHaveBeenCalledWith([]);
    const graph = tm().performance();
    expect(graph.resources.map((resource) => [resource.id, resource.label, resource.detail])).toEqual([
      ['cpu', 'CPU', '12%  2.30 GHz'],
      ['memory', 'Memory', '4.0/8.0 GB (50%)'],
      ['disk', 'Disk', 'R: 0 KB/s  W: 0 KB/s'],
      ['net:eth0', 'Ethernet', 'S: 8 Kbps  R: 1.0 Mbps'],
    ]);
    // Each sample where it was taken in the last sixty seconds, the newest at the right edge.
    expect(graph.page?.graphs[0]?.series[0]).toMatchObject({ values: [0.1, 0.5], x: [50 / 60, 1] });
    expect(graph.page?.stats.find((stat) => stat.label === 'Up time')?.value).toBe('1:01:01:01');

    tm().setCpuView('logical');
    expect(tm().performance().page?.graphs.map((one) => one.label)).toEqual(['CPU 0', 'CPU 1']);
    tm().setSpan('10m');
    expect(tm().performance().page?.graphs[0]?.series[0]?.x).toEqual([590 / 600, 1]);

    tm().selectResource('net:eth0');
    const network = tm().performance().page;
    expect(network).toMatchObject({ title: 'Ethernet', subtitle: 'eth0', graphLabel: 'Throughput', maxLabel: '1 Mbps' });
    expect(network?.graphs[0]?.series.map((series) => [series.label, series.values.at(-1), series.dashed ?? false])).toEqual([
      ['Receive', 1, false],
      ['Send', 0.008, true],
    ]);

    workbench.commandsFt.run('process.showProcesses');
    await vi.advanceTimersByTimeAsync(TASK_MANAGER_POLL_MS);
    expect(history).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(TASK_MANAGER_KEY) ?? 'null')).toMatchObject({ view: 'processes', span: '10m', cpuView: 'logical' });
  });

  it('asks every two seconds while shown — whatever pace the backend says — and nothing once another sub-application is (§4.1)', async () => {
    const list = answer(snapshot([process(1)], { intervalMs: 10_000 }));
    await open();
    // Asking every two seconds is what keeps the backend at its fast pace.
    await vi.advanceTimersByTimeAsync(TASK_MANAGER_POLL_MS * 2);
    expect(list).toHaveBeenCalledTimes(3);

    workbench.subAppsFt.show('file-manager');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(list).toHaveBeenCalledTimes(3);

    workbench.subAppsFt.show('task-manager');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(4);
  });

  it('keeps the group selected when it is closed over the process selected in it', async () => {
    answer(snapshot([process(1, { name: 'x', path: '/x' }), process(2, { name: 'x', path: '/x' })]));
    await open();
    tm().toggle('g:x');
    tm().select('p:2:1');
    tm().toggle('g:x');
    expect(tm().model().selectedId).toBe('g:x');
  });
});
