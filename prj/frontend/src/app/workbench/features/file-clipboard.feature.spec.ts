import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsOperationJob } from '../../file-system/file-system.model';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/** PRD 005, §2 — copy / cut / paste and drag and drop, as the workbench carries them out. */

const done = (kind: 'copy' | 'move'): FsOperationJob => ({
  id: `job-${kind}`,
  kind,
  state: 'done',
  title: kind,
  startedAt: '2026-09-26T10:00:00.000Z',
  finishedAt: '2026-09-26T10:00:01.000Z',
  totalBytes: 0,
  doneBytes: 0,
  totalItems: 1,
  doneItems: 1,
  current: null,
  skipped: 0,
  error: null,
  affected: [],
});

describe('FileClipboardFeature and entry drops', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let group: string;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.editorGroupsFt.start();
    http
      .expectOne(listUrl(''))
      .flush(fsEnvelope(fsListing('', [fsDirectory('docs'), fsEntry('a.txt'), fsEntry('b.txt')])));
    await settled();
    group = workbench.activeGroupId();
    vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const clipboard = () => workbench.fileClipboardFt;
  const select = (...paths: string[]) =>
    workbench.editorGroupsFt.update(group, (state) => ({ ...state, selection: paths }));
  const row = (id: string) => workbench.fileBrowserFt.browser(group)?.rows.find((candidate) => candidate.id === id);

  describe('copy, cut and paste', () => {
    it('Ctrl+C puts the selection on the clipboard, and a paste copies it into the panel’s folder', async () => {
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done('copy'));
      select('a.txt', 'b.txt');

      workbench.panelKeyboardFt.run(group, { command: 'copy', entryId: 'a.txt' });
      expect(clipboard().clipboard()).toEqual({ mode: 'copy', paths: ['a.txt', 'b.txt'] });

      await clipboard().paste(group);
      await clipboard().paste(group);

      expect(start).toHaveBeenCalledTimes(2);
      expect(start).toHaveBeenCalledWith({ kind: 'copy', sources: ['a.txt', 'b.txt'], destination: '', conflict: 'fail' });
      expect(clipboard().canPaste()).toBe(true);
    });

    it('Ctrl+X draws the entries faded, and the paste moves them and empties the clipboard', async () => {
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done('move'));
      select('a.txt');

      workbench.panelKeyboardFt.run(group, { command: 'cut', entryId: 'a.txt' });
      expect(row('a.txt')?.cut).toBe(true);
      expect(row('b.txt')?.cut).toBeUndefined();

      workbench.editorGroupsFt.update(group, (state) => ({ ...state, path: 'docs' }));
      workbench.panelKeyboardFt.run(group, { command: 'paste', entryId: null });
      await settled();

      expect(start).toHaveBeenCalledWith({ kind: 'move', sources: ['a.txt'], destination: 'docs', conflict: 'fail' });
      expect(clipboard().clipboard()).toBeNull();
    });

    it('keeps a cut that was pasted where it already is, or whose conflict question was cancelled', async () => {
      const start = vi
        .spyOn(workbench.fileSystem.operationsFt, 'start')
        .mockRejectedValue(Object.assign(new Error('taken'), { name: 'FsError' }));
      vi.spyOn(workbench.modal, 'message').mockResolvedValue();
      select('a.txt');
      clipboard().cut(group);

      await clipboard().paste(group);
      expect(start).not.toHaveBeenCalled();

      workbench.editorGroupsFt.update(group, (state) => ({ ...state, path: 'docs' }));
      await clipboard().paste(group);
      expect(start).toHaveBeenCalledTimes(1);
      expect(clipboard().clipboard()).toEqual({ mode: 'cut', paths: ['a.txt'] });
    });

    it('copies the entry the key was pressed on when it is not selected', () => {
      select('b.txt');

      clipboard().copy(group, 'a.txt');

      expect(clipboard().clipboard()?.paths).toEqual(['a.txt']);
    });

    it('forgets entries a finished job took away', () => {
      select('a.txt', 'b.txt');
      clipboard().cut(group);

      clipboard().forget((path) => path === 'a.txt');
      expect(clipboard().clipboard()?.paths).toEqual(['b.txt']);
      clipboard().forget(() => true);
      expect(clipboard().clipboard()).toBeNull();
    });

    it('drives the Edit menu', () => {
      const edit = () => workbench.chromeFt.menuItems().find((menu) => menu.id === 'edit')?.items ?? [];
      select();
      expect(edit().map((item) => [item.id, !!item.disabled])).toEqual([
        ['edit.cut', true],
        ['edit.copy', true],
        ['edit.paste', true],
      ]);

      select('a.txt');
      workbench.chromeFt.runMenuItem({ menuId: 'edit', itemId: 'edit.copy' });
      expect(edit().every((item) => !item.disabled)).toBe(true);
      expect(clipboard().clipboard()?.mode).toBe('copy');
    });
  });

  describe('drops', () => {
    it('marks folders as drop targets, and the listing as one', () => {
      expect(row('docs')?.dropTarget).toBe(true);
      expect(row('a.txt')?.dropTarget).toBeUndefined();
      expect(workbench.fileBrowserFt.browser(group)?.dropFolder).toBe(true);
    });

    it('moves onto a folder by default, and copies with Ctrl', async () => {
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done('move'));

      workbench.fileBrowserFt.dropEntries(group, { sources: ['a.txt'], target: 'docs', copy: false });
      workbench.fileBrowserFt.dropEntries(group, { sources: ['b.txt'], target: 'docs', copy: true });
      await settled();

      expect(start.mock.calls.map(([request]) => request)).toEqual([
        { kind: 'move', sources: ['a.txt'], destination: 'docs', conflict: 'fail' },
        { kind: 'copy', sources: ['b.txt'], destination: 'docs', conflict: 'fail' },
      ]);
    });

    it('drops on blank space into the folder the panel lists — from another panel', async () => {
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(done('move'));
      workbench.editorGroupsFt.update(group, (state) => ({ ...state, path: 'docs' }));

      workbench.fileBrowserFt.dropEntries(group, { sources: ['a.txt'], target: null, copy: false });
      await settled();

      expect(start).toHaveBeenCalledWith({ kind: 'move', sources: ['a.txt'], destination: 'docs', conflict: 'fail' });
    });

    it('starts nothing for a move to where the entries already are', async () => {
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start');

      workbench.fileBrowserFt.dropEntries(group, { sources: ['a.txt'], target: null, copy: false });
      await settled();

      expect(start).not.toHaveBeenCalled();
    });
  });
});
