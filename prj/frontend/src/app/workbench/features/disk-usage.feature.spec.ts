import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsDiskUsageNode, FsDiskUsageReport, FsDiskUsageScan } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { WorkbenchService } from '../workbench.service';
import { DISK_USAGE_DEFAULT_DEPTH, DISK_USAGE_POLL_MS } from './disk-usage.feature';

/** PRD 013 — the Disk Usage sub-application: panels of folders, drawn from scans on the backend. */

const folder = (path: string, size: number, children?: FsDiskUsageNode[], state: FsDiskUsageNode['state'] = 'done'): FsDiskUsageNode => ({
  kind: 'folder',
  name: path.split('/').at(-1) ?? '',
  path,
  size,
  onDisk: size,
  files: 1,
  folders: children?.length ?? 0,
  state,
  ...(children === undefined ? {} : { children }),
});

const scanOf = (id: string, path: string, state: FsDiskUsageScan['state'], report?: FsDiskUsageReport, tree: FsDiskUsageNode | null = null): FsDiskUsageScan => ({
  id,
  path,
  state,
  startedAt: '2026-10-02T10:00:00.000Z',
  finishedAt: state === 'running' ? null : '2026-10-02T10:00:05.000Z',
  elapsedMs: 5000,
  maxDepth: 100,
  totals: { size: 2048, onDisk: 4096, files: 3, folders: 1, errors: 0, skipped: 0 },
  current: null,
  ...(report === undefined ? {} : { report: { path: report.path ?? path, depth: report.depth ?? 1, tree } }),
});

describe('DiskUsageFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const du = () => workbench.diskUsageFt;
  const fs = () => workbench.fileSystem.diskUsageFt;
  const group = () => du().activeGroupId();
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('opens a folder in a tab of its own panels, scanned on the backend and asked again every 3 s', async () => {
    const tree = folder('docs', 2048, [folder('docs/big', 2000), { kind: 'file', name: 'a.txt', path: 'docs/a.txt', size: 48, onDisk: 4096, files: 1, folders: 0 }], 'scanning');
    const start = vi.spyOn(fs(), 'start').mockResolvedValue(scanOf('s1', 'docs', 'running', { depth: DISK_USAGE_DEFAULT_DEPTH }, tree));
    const status = vi.spyOn(fs(), 'status').mockResolvedValue(scanOf('s1', 'docs', 'done', { path: 'docs', depth: DISK_USAGE_DEFAULT_DEPTH }, folder('docs', 2048, [folder('docs/big', 2000)])));

    du().open('docs');
    await flush();
    expect(workbench.subAppsFt.active()).toBe('disk-usage');
    expect(start).toHaveBeenCalledWith('docs', DISK_USAGE_DEFAULT_DEPTH);
    expect(du().group(group())?.tabs).toEqual([{ id: expect.any(String), label: 'docs', icon: 'database', active: true }]);

    const model = du().content(group());
    expect(model?.view).toBe('pie');
    expect(model?.root).toMatchObject({ name: 'docs', size: 2048, note: 'scanning…' });
    expect(model?.root?.children?.map((child) => [child.name, child.openable ?? false])).toEqual([
      ['big', true],
      ['a.txt', false],
    ]);
    expect(model?.summary).toBe('Scanning… 3 files · 2.0 KB · 0:05');
    expect(model?.toolbarActions.map((action) => action.id)).toEqual(['up', 'refresh', 'stop']);

    // Not asked again sooner than every 3 s.
    await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS - 1);
    expect(status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenCalledWith('s1', { path: 'docs', depth: DISK_USAGE_DEFAULT_DEPTH });
    expect(du().content(group())?.summary).toMatch(/scanned in 0:05$/);
    // Done: no more asking.
    await vi.advanceTimersByTimeAsync(DISK_USAGE_POLL_MS * 3);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('goes into a folder and back up on the same scan, and rescans outside it', async () => {
    const start = vi.spyOn(fs(), 'start').mockImplementation(async (path) => scanOf(`scan:${path}`, path, 'done', { depth: 2 }, folder(path, 10)));
    const status = vi.spyOn(fs(), 'status').mockImplementation(async (id, report) =>
      scanOf(id, id.slice('scan:'.length), 'done', report, folder(report?.path ?? '', 5)),
    );
    du().open('docs');
    await flush();
    expect(start).toHaveBeenCalledTimes(1);

    du().openEntry(group(), 'docs/big');
    await flush();
    expect(status).toHaveBeenLastCalledWith('scan:docs', { path: 'docs/big', depth: 2 });
    expect(du().folder()).toBe('docs/big');
    expect(du().content(group())?.breadcrumbs.map((crumb) => crumb.id)).toEqual(['root', 'docs', 'docs/big']);

    du().runToolbarAction(group(), 'up');
    await flush();
    expect(status).toHaveBeenLastCalledWith('scan:docs', { path: 'docs', depth: 2 });

    du().runToolbarAction(group(), 'up');
    await flush();
    // The root is outside the scan of `docs`: a scan of its own.
    expect(start).toHaveBeenLastCalledWith('', 2);
    expect(du().content(group())?.toolbarActions.find((action) => action.id === 'up')?.disabled).toBe(true);
  });

  it('scans a folder the scan did not go into — another disk — on its own', async () => {
    const start = vi.spyOn(fs(), 'start').mockImplementation(async (path) => scanOf(`scan:${path}`, path, 'done', { depth: 2 }, folder(path, 10)));
    vi.spyOn(fs(), 'status').mockImplementation(async (id, report) => scanOf(id, 'docs', 'done', report, folder(report?.path ?? '', 0, undefined, 'mount')));
    du().open('docs');
    await flush();
    du().openEntry(group(), 'docs/mnt');
    await flush();
    expect(start).toHaveBeenLastCalledWith('docs/mnt', 2);
  });

  it('changes the view and the depth, the depth asked of the scan', async () => {
    vi.spyOn(fs(), 'start').mockResolvedValue(scanOf('s1', 'docs', 'done', { depth: 2 }, folder('docs', 10)));
    const status = vi.spyOn(fs(), 'status').mockImplementation(async (id, report) => scanOf(id, 'docs', 'done', report, folder('docs', 10)));
    du().open('docs');
    await flush();
    du().setView(group(), 'rectangles');
    expect(du().content(group())?.view).toBe('rectangles');
    du().setDepth(group(), 4);
    await flush();
    expect(status).toHaveBeenLastCalledWith('s1', { path: 'docs', depth: 4 });
    du().setDepth(group(), 99);
    expect(du().content(group())?.depth).toBe(8);
  });

  it('stops a scan, and scans again from scratch', async () => {
    const start = vi.spyOn(fs(), 'start').mockResolvedValue(scanOf('s1', 'docs', 'running', { depth: 2 }, folder('docs', 10)));
    const cancel = vi.spyOn(fs(), 'cancel').mockResolvedValue(scanOf('s1', 'docs', 'cancelled'));
    vi.spyOn(fs(), 'status').mockResolvedValue(scanOf('s1', 'docs', 'cancelled', { path: 'docs', depth: 2 }, folder('docs', 10, undefined, 'scanning')));
    du().open('docs');
    await flush();
    expect(du().content(group())?.toolbarActions.find((action) => action.id === 'stop')?.label).toBe('Stop scanning (Escape)');
    du().runToolbarAction(group(), 'stop');
    await flush();
    expect(cancel).toHaveBeenCalledWith('s1');
    expect(du().content(group())?.summary).toBe('Stopped: 3 files · 2.0 KB so far');
    expect(du().content(group())?.toolbarActions.some((action) => action.id === 'stop')).toBe(false);
    // What it had not finished says so, rather than that it is still being scanned (PRD 013, §2.1.1).
    expect(du().content(group())?.root?.note).toBe('not all scanned');

    start.mockResolvedValue(scanOf('s2', 'docs', 'running', { depth: 2 }, folder('docs', 10)));
    du().runToolbarAction(group(), 'refresh');
    await flush();
    expect(start).toHaveBeenCalledTimes(2);
    expect(du().tabState(du().stateOf(group())?.activeTabId as string)?.scanId).toBe('s2');
  });

  it('scans again when the backend has forgotten the scan', async () => {
    const start = vi.spyOn(fs(), 'start').mockResolvedValue(scanOf('s1', 'docs', 'done', { depth: 2 }, folder('docs', 10)));
    vi.spyOn(fs(), 'status').mockRejectedValue(new FsError('No such disk usage scan', 404, 'NOT_FOUND'));
    du().open('docs');
    await flush();
    du().selectTab(group(), du().stateOf(group())?.activeTabId as string);
    await flush();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('says why a folder cannot be scanned', async () => {
    vi.spyOn(fs(), 'start').mockRejectedValue(new FsError('Choose a drive to scan', 400, 'BAD_REQUEST'));
    du().open('');
    await flush();
    expect(du().content(group())?.empty).toMatchObject({ title: 'Could not scan this folder', hint: 'Choose a drive to scan' });
  });

  it('splits, opens new tabs on the same folder, and stops a scan no tab shows any more', async () => {
    vi.spyOn(fs(), 'start').mockResolvedValue(scanOf('s1', 'docs', 'running', { depth: 2 }, folder('docs', 10)));
    vi.spyOn(fs(), 'status').mockImplementation(async (id, report) => scanOf(id, 'docs', 'running', report, folder('docs', 10)));
    const cancel = vi.spyOn(fs(), 'cancel').mockResolvedValue(scanOf('s1', 'docs', 'cancelled'));
    du().open('docs');
    await flush();
    const first = group();

    du().runAction(first, 'split-right');
    await flush();
    expect(du().layout.groupIds()).toHaveLength(2);
    const second = group();
    expect(second).not.toBe(first);
    expect(du().content(second)?.location).toBe('/docs');

    du().runAction(second, 'new-tab');
    await flush();
    expect(du().stateOf(second)?.tabs).toHaveLength(2);

    // Closing every tab of the split-off panel takes the panel; the scan is still shown in the first.
    for (const tab of du().stateOf(second)?.tabs ?? []) {
      du().closeTab(second, tab.id);
    }
    expect(du().layout.groupIds()).toEqual([first]);
    expect(cancel).not.toHaveBeenCalled();

    du().closeTab(first, du().stateOf(first)?.activeTabId as string);
    expect(cancel).toHaveBeenCalledWith('s1');
    expect(du().group(first)?.empty?.title).toBe('No folder open');
  });

  it('starts on the file manager\'s folder when shown with nothing open', async () => {
    const start = vi.spyOn(fs(), 'start').mockResolvedValue(scanOf('s1', '', 'done', { depth: 2 }, folder('', 10)));
    const files = workbench.editorGroupsFt;
    files.update(workbench.activeGroupId(), (state) => ({ ...state, path: 'docs', tabs: state.tabs.map((tab) => ({ ...tab, path: 'docs' })) }));
    workbench.chromeFt.selectActivity('disk-usage');
    await flush();
    expect(start).toHaveBeenCalledWith('docs', 2);
    // Shown again: nothing new.
    workbench.chromeFt.selectActivity('file-manager');
    workbench.chromeFt.selectActivity('disk-usage');
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
