import type { FsProcess } from '../../file-system/file-system.model';
import { formatMemory, formatPercent, formatRate, groupProcesses, statusLabel } from './process-rows';

/** PRD 014, §2 — how Task Manager gathers, words and shades its rows. */

const process = (pid: number, patch: Partial<FsProcess> = {}): FsProcess => ({
  pid,
  ppid: 1,
  key: `${pid}:1`,
  name: `p${pid}`,
  path: null,
  command: 'x',
  user: null,
  title: null,
  status: 'sleeping',
  category: 'background',
  cpu: 0,
  memory: 0,
  disk: null,
  threads: null,
  startedAt: null,
  ...patch,
});

describe('process rows', () => {
  it('gathers an executable’s processes, whatever path each could say, and the kernel’s threads by kind', () => {
    const groups = groupProcesses(
      [
        process(1, { name: 'dbus-daemon', path: '/usr/bin/dbus-daemon', memory: 10 }),
        process(2, { name: 'dbus-daemon', memory: 5, disk: 7 }),
        process(3, { name: 'kworker/0:1-events', command: null, category: 'system' }),
        process(4, { name: 'kworker/u16:3', command: null, category: 'system' }),
        process(5, { name: 'Chrome.exe', category: 'app' }),
        process(6, { name: 'chrome.exe' }),
      ],
      'win32',
    );
    expect(groups.map((group) => [group.id, group.label, group.processes.length, group.category])).toEqual([
      ['g:dbus-daemon', 'dbus-daemon', 2, 'background'],
      ['g:kernel:kworker', 'kworker', 2, 'system'],
      // An app with helpers in the background is an app; on Windows names ignore case.
      ['g:chrome.exe', 'Chrome.exe', 2, 'app'],
    ]);
    expect(groups[0]).toMatchObject({ memory: 15, disk: 7 });
  });

  it('words numbers and states as Task Manager does', () => {
    expect([formatPercent(0), formatPercent(0.04), formatPercent(12.34), formatPercent(100)]).toEqual(['0%', '0%', '12.3%', '100%']);
    expect(formatMemory(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatMemory(20 * 1024 ** 3)).toBe('20.0 GB');
    expect([formatRate(0), formatRate(10), formatRate(5 * 1024 * 1024)]).toEqual(['0 MB/s', '0.1 MB/s', '5.0 MB/s']);
    expect(['running', 'suspended', 'not-responding', 'zombie'].map((status) => statusLabel(process(1, { status: status as FsProcess['status'] })))).toEqual([
      '',
      'Suspended',
      'Not responding',
      'Ended',
    ]);
  });
});
