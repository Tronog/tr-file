import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsOperationJob } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { OperationProgressModal } from '../operations/operation-progress-modal';
import { WorkbenchService } from '../workbench.service';
import { OPERATION_POLL_MS } from './operations.feature';

/** PRD 005, §1 — file operations as the workbench starts, confirms and follows them. */

const job = (overrides: Partial<FsOperationJob> = {}): FsOperationJob => ({
  id: 'job-1',
  kind: 'trash',
  state: 'running',
  title: "Moving 'a.txt' to the trash",
  startedAt: '2026-09-26T10:00:00.000Z',
  finishedAt: null,
  totalBytes: null,
  doneBytes: 0,
  totalItems: 1,
  doneItems: 0,
  current: null,
  skipped: 0,
  error: null,
  affected: ['docs'],
  ...overrides,
});

describe('OperationsFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    vi.spyOn(workbench.fileSystem.operationsFt, 'operationsInfo').mockResolvedValue({ trash: 'server' });
    vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const ops = () => workbench.operationsFt;
  const fs = () => workbench.fileSystem.operationsFt;

  /** Selects `paths` in the active panel, which shows a folder on start. */
  function select(...paths: string[]): string {
    const id = workbench.activeGroupId();
    workbench.editorGroupsFt.update(id, (group) => ({ ...group, path: 'docs', selection: paths }));
    return id;
  }

  describe('move to trash', () => {
    it('asks first, and starts nothing when the answer is no', async () => {
      const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);
      const start = vi.spyOn(fs(), 'start');

      await ops().trashSelection(select('docs/a.txt'));

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          message: "Are you sure you want to move 'a.txt' to the Trash?",
          confirmLabel: 'Move to Trash',
        }),
      );
      expect(start).not.toHaveBeenCalled();
    });

    it('lists the names when there are several', async () => {
      const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);

      await ops().trashSelection(select('docs/a.txt', 'docs/b.txt'));

      expect(confirm.mock.calls[0]?.[0].message).toBe('Are you sure you want to move these 2 items to the Trash?');
      expect(confirm.mock.calls[0]?.[0].detail).toContain('a.txt\nb.txt');
    });

    it('trashes the row the key was pressed on when it is not part of the selection', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      const start = vi.spyOn(fs(), 'start').mockResolvedValue(job({ state: 'done' }));

      await ops().trashSelection(select('docs/a.txt', 'docs/b.txt'), 'docs/c.txt');

      expect(start).toHaveBeenCalledWith({ kind: 'trash', paths: ['docs/c.txt'], errors: 'ask' });
    });

    it('re-reads what changed and drops the trashed entries from the selection', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(fs(), 'start').mockResolvedValue(job({ state: 'done' }));
      const group = select('docs/a.txt', 'docs/b.txt');

      await ops().trash(['docs/a.txt']);

      expect(workbench.fsDataFt.invalidateListing).toHaveBeenCalledWith('docs');
      expect(workbench.editorGroupsFt.stateOf(group)?.selection).toEqual(['docs/b.txt']);
    });

    it('says what the server said when it refuses', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(fs(), 'start').mockRejectedValue(new FsError('Permission denied', 403, 'FORBIDDEN'));
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();

      await ops().trash(['docs/a.txt']);

      expect(message).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', message: 'Could not move to the trash.', detail: 'Permission denied' }),
      );
    });

    it('explains itself when nothing is selected', async () => {
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();

      await ops().trashSelection(select());

      expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: 'Select what to move to the trash first.' }));
    });
  });

  describe('empty trash', () => {
    it('asks, warning it cannot be undone', async () => {
      const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      const start = vi.spyOn(fs(), 'start').mockResolvedValue(job({ kind: 'empty-trash', state: 'done' }));

      await ops().emptyTrash();

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ detail: 'This cannot be undone.', confirmLabel: 'Empty Trash' }),
      );
      expect(start).toHaveBeenCalledWith({ kind: 'empty-trash' });
    });
  });

  describe('copy and move', () => {
    it('asks where to, offering the next panel’s folder', async () => {
      const prompt = vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('/target/');
      const start = vi.spyOn(fs(), 'start').mockResolvedValue(job({ kind: 'copy', state: 'done' }));
      const group = select('docs/a.txt');

      await ops().copySelection(group);

      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ message: "Copy 'a.txt' to:", confirmLabel: 'Copy' }));
      expect(start).toHaveBeenCalledWith({ kind: 'copy', sources: ['docs/a.txt'], destination: 'target', conflict: 'fail', errors: 'ask' });
    });

    it('asks about taken names once, and starts again with the answer', async () => {
      const start = vi
        .spyOn(fs(), 'start')
        .mockRejectedValueOnce(new FsError('taken', 409, 'CONFLICT', { conflicts: ['a.txt', 'b.txt'] }))
        .mockResolvedValue(job({ kind: 'move', state: 'done' }));
      const show = vi.spyOn(workbench.modal, 'show').mockResolvedValue({ buttonId: 'rename', checked: false, value: '' });

      await ops().transfer('move', ['docs/a.txt', 'docs/b.txt'], 'target');

      expect(show.mock.calls[0]?.[0].message).toBe("2 items already exist in '/target'. Do you want to replace them?");
      expect(start).toHaveBeenLastCalledWith({
        kind: 'move',
        sources: ['docs/a.txt', 'docs/b.txt'],
        destination: 'target',
        conflict: 'rename',
        errors: 'ask',
      });
    });

    it('starts nothing when the conflict question is cancelled', async () => {
      const start = vi.spyOn(fs(), 'start').mockRejectedValue(new FsError('taken', 409, 'CONFLICT', { conflicts: ['a.txt'] }));
      vi.spyOn(workbench.modal, 'show').mockResolvedValue(null);

      await ops().transfer('copy', ['docs/a.txt'], 'target');

      expect(start).toHaveBeenCalledTimes(1);
      expect(ops().rows()).toEqual([]);
    });
  });

  describe('following a job', () => {
    it('polls once a second, and not before', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(workbench.modal, 'open').mockReturnValue(new Promise(() => undefined));
      vi.spyOn(fs(), 'start').mockResolvedValue(job());
      const status = vi.spyOn(fs(), 'status').mockResolvedValue(job({ doneItems: 0 }));

      await ops().trash(['docs/a.txt']);
      expect(ops().runningCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS - 1);
      expect(status).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(status).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS);
      expect(status).toHaveBeenCalledTimes(2);
    });

    it('opens the progress window for a job still running at its first poll, once', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      const open = vi.spyOn(workbench.modal, 'open').mockReturnValue(new Promise(() => undefined));
      vi.spyOn(fs(), 'start').mockResolvedValue(job());
      vi.spyOn(fs(), 'status').mockResolvedValue(job());

      await ops().trash(['docs/a.txt']);
      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS * 3);

      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0]?.[0]).toBe(OperationProgressModal);
    });

    it('never opens a window for a job that ended before its first poll', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      const open = vi.spyOn(workbench.modal, 'open');
      vi.spyOn(fs(), 'start').mockResolvedValue(job());
      vi.spyOn(fs(), 'status').mockResolvedValue(job({ state: 'done', doneItems: 1 }));

      await ops().trash(['docs/a.txt']);
      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS * 2);

      expect(open).not.toHaveBeenCalled();
      expect(ops().rows()[0]).toMatchObject({ icon: 'check', statusLabel: 'done' });
      expect(workbench.fsDataFt.invalidateListing).toHaveBeenCalledWith('docs');
    });

    it('shows bytes in its row and dialog, and is cancellable from the Progress tab', async () => {
      vi.spyOn(fs(), 'start').mockResolvedValue(
        job({ kind: 'copy', title: 'Copying 2 items to /target', totalBytes: 4096, doneBytes: 1024, totalItems: 2, current: 'docs/a.txt' }),
      );
      const cancel = vi.spyOn(fs(), 'cancel').mockResolvedValue(job({ kind: 'copy', state: 'cancelled' }));

      await ops().transfer('copy', ['docs/a.txt', 'docs/b.txt'], 'target');

      expect(ops().rows()[0]).toMatchObject({ icon: 'copy', progress: 25, statusLabel: '25%', cancellable: true, detail: '/docs/a.txt' });
      expect(ops().dialogModel('job-1')).toMatchObject({
        progress: 25,
        status: '0 of 2 items · 1.0 KB of 4.0 KB',
        current: '/docs/a.txt',
        state: 'running',
      });

      ops().cancel('job-1');
      expect(ops().rows()[0]).toMatchObject({ statusLabel: 'cancelling…' });
      await vi.advanceTimersByTimeAsync(0);

      expect(cancel).toHaveBeenCalledWith('job-1');
      expect(ops().rows()[0]).toMatchObject({ icon: 'x', statusLabel: 'cancelled' });
      expect(ops().runningCount()).toBe(0);
    });

    it('opens the Progress tab for a failure nobody was watching', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(fs(), 'start').mockResolvedValue(job({ state: 'failed', error: { code: 'FORBIDDEN', message: 'Permission denied' } }));

      await ops().trash(['docs/a.txt']);

      expect(workbench.bottomPanelFt.progressVisible()).toBe(true);
      expect(workbench.bottomPanelFt.collapsed()).toBe(false);
      expect(ops().rows()[0]).toMatchObject({ statusLabel: 'failed', detail: 'Permission denied' });
    });

    it('clears what has ended, keeping what runs', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(fs(), 'start')
        .mockResolvedValueOnce(job({ id: 'a', state: 'done' }))
        .mockResolvedValueOnce(job({ id: 'b' }));

      await ops().trash(['docs/a.txt']);
      await ops().trash(['docs/b.txt']);
      ops().clearFinished();

      expect(ops().rows().map((row) => row.id)).toEqual(['b']);
      expect(workbench.bottomPanelFt.tabs().find((tab) => tab.id === 'progress')?.count).toBe(1);
    });
  });

  describe('entry points', () => {
    it('Delete in a panel moves the selection to the trash, after asking', async () => {
      const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);
      const group = select('docs/a.txt');

      workbench.panelKeyboardFt.run(group, { command: 'delete', entryId: 'docs/a.txt' });
      await vi.advanceTimersByTimeAsync(0);

      expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('the File menu’s operations are disabled while nothing is selected, but Empty Trash', () => {
      const operations = ['file.copyTo', 'file.moveTo', 'file.trash', 'file.delete', 'file.emptyTrash'];
      const rows = () =>
        (workbench.chromeFt.menuItems().find((menu) => menu.id === 'file')?.items ?? [])
          .filter((item) => operations.includes(item.id))
          .map((item) => [item.id, item.disabled === true]);
      select();

      expect(rows()).toEqual([
        ['file.copyTo', true],
        ['file.moveTo', true],
        ['file.trash', true],
        ['file.delete', true],
        ['file.emptyTrash', false],
      ]);

      select('docs/a.txt');
      expect(rows().some(([, disabled]) => disabled)).toBe(false);
    });

    it('the palette offers the operations that apply', () => {
      select('docs/a.txt');
      expect(workbench.commandPaletteFt.commands.map((command) => command.id)).toEqual(
        expect.arrayContaining(['file.copyTo', 'file.moveTo', 'file.trash', 'file.delete', 'file.emptyTrash']),
      );
    });
  });

  /**
   * PRD 001, Fix 3 — an entry a job could not do, as Midnight Commander asks
   * about it: Skip, Skip All, Retry or Abort; `Escape` is Abort.
   */
  describe('an entry it could not do', () => {
    const waiting = job({
      state: 'waiting',
      problem: { path: 'docs/secret.txt', code: 'FORBIDDEN', message: 'Permission denied: secret.txt' },
    });

    const startWaiting = async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(workbench.modal, 'open').mockReturnValue(new Promise(() => undefined));
      vi.spyOn(fs(), 'start').mockResolvedValue(job());
      vi.spyOn(fs(), 'status').mockResolvedValue(waiting);
      await ops().trash(['docs/a.txt']);
    };

    it('asks the job to wait, and asks the user what to do — once, however long it waits', async () => {
      await startWaiting();
      const show = vi.spyOn(workbench.modal, 'show').mockReturnValue(new Promise(() => undefined));

      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS * 3);

      expect(show).toHaveBeenCalledTimes(1);
      expect(show.mock.calls[0]?.[0]).toMatchObject({
        severity: 'error',
        message: "Cannot move to the trash 'secret.txt'",
        detail: 'Permission denied: secret.txt\n/docs/secret.txt',
        buttons: [
          { id: 'skip', label: 'Skip' },
          { id: 'skip-all', label: 'Skip All' },
          { id: 'retry', label: 'Retry' },
          { id: 'abort', label: 'Abort' },
        ],
      });
      expect(ops().runningCount()).toBe(1);
      expect(ops().rows()[0]).toMatchObject({ statusLabel: 'waiting', detail: 'Permission denied: secret.txt — /docs/secret.txt', cancellable: true });
    });

    it('sends the answer, and follows the job on from there', async () => {
      await startWaiting();
      vi.spyOn(workbench.modal, 'show').mockResolvedValue({ buttonId: 'skip-all', checked: false, value: '' });
      const resolve = vi.spyOn(fs(), 'resolve').mockResolvedValue(job({ state: 'running' }));

      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS);

      expect(resolve).toHaveBeenCalledWith('job-1', 'skip-all');
    });

    it('takes Escape as Abort, as Midnight Commander does', async () => {
      await startWaiting();
      vi.spyOn(workbench.modal, 'show').mockResolvedValue(null);
      const resolve = vi.spyOn(fs(), 'resolve').mockResolvedValue(
        job({ state: 'cancelled', error: { code: 'FORBIDDEN', message: 'Permission denied: secret.txt' } }),
      );

      await vi.advanceTimersByTimeAsync(OPERATION_POLL_MS);

      expect(resolve).toHaveBeenCalledWith('job-1', 'abort');
      expect(ops().rows()[0]).toMatchObject({ statusLabel: 'cancelled', detail: 'Permission denied: secret.txt' });
      expect(ops().runningCount()).toBe(0);
    });

    it('drops an answer that comes too late', async () => {
      await startWaiting();
      vi.spyOn(workbench.modal, 'show').mockResolvedValue({ buttonId: 'retry', checked: false, value: '' });
      vi.spyOn(fs(), 'resolve').mockRejectedValue(new FsError('not waiting', 409, 'CONFLICT'));

      await expect(vi.advanceTimersByTimeAsync(OPERATION_POLL_MS)).resolves.not.toThrow();
      expect(ops().runningCount()).toBe(1);
    });

    it('asks every job to wait rather than fail — copy, move, trash, delete, restore', async () => {
      const start = vi.spyOn(fs(), 'start').mockResolvedValue(job({ state: 'done' }));
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);

      await ops().transfer('copy', ['docs/a.txt'], 'target');
      await ops().trash(['docs/a.txt']);
      await ops().deletePermanently(['docs/a.txt']);
      await ops().restore(['a.txt.1']);

      expect(start.mock.calls.map(([request]) => (request as { errors?: string }).errors)).toEqual(['ask', 'ask', 'ask', 'ask']);
    });
  });
});
