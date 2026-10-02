import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsOperationJob } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import {
  detailsUrl,
  fsDetails,
  fsDirectory,
  fsDirectoryDetails,
  fsEntry,
  fsEnvelope,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { nameProblem, relocatePath } from './file-edit.feature';
import { SEARCH_DEBOUNCE_MS } from './search.feature';

/**
 * PRD 003, §5 — what every file manager has: rename, new folder and file,
 * right-click menus, sorting, filtering, the editable path bar, Back and
 * Forward, opening with the system, undo, permanent delete, search and
 * auto-refresh, as the workbench carries them out.
 */

const ROOT = [
  fsDirectory('docs'),
  fsEntry('b.txt', { size: 30 }),
  fsEntry('a.txt', { size: 10 }),
  fsEntry('c.pdf', { size: 20 }),
];

const job = (overrides: Partial<FsOperationJob>): FsOperationJob => ({
  id: 'job',
  kind: 'copy',
  state: 'done',
  title: 'job',
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
  outcome: [],
  ...overrides,
});

describe('File management (PRD 003, §5)', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  const group = 'group-root';

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT)));
    await settled();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const browser = () => workbench.fileBrowserFt.browser(group);
  const rows = () => browser()?.rows.map((row) => row.id);
  const select = (...paths: string[]) =>
    workbench.editorGroupsFt.update(group, (state) => ({ ...state, selection: paths, focusedEntryId: paths[0] }));
  /** Answers the listing a change reads again, and any details the selection asks for. */
  const answerListing = async (path: string, entries: Parameters<typeof fsListing>[1]): Promise<void> => {
    http.expectOne(listUrl(path)).flush(fsEnvelope(fsListing(path, entries)));
    await settled();
    for (const request of http.match((candidate) => candidate.url.startsWith('/api/fs/details'))) {
      request.flush(fsEnvelope(fsDetails(new URLSearchParams(request.request.url.split('?')[1]).get('path') ?? '')));
    }
    await settled();
  };

  describe('sorting and filtering', () => {
    it('lists in name order, and a header click sorts by that column, then turns it round', () => {
      expect(rows()).toEqual(['docs', 'a.txt', 'b.txt', 'c.pdf']);
      expect(browser()?.sortable).toBe(true);
      expect(browser()?.columns.find((column) => column.sort)).toMatchObject({ key: 'name', sort: 'asc' });

      workbench.fileBrowserFt.toggleSort(group, 'size');
      expect(rows()).toEqual(['docs', 'a.txt', 'c.pdf', 'b.txt']);
      workbench.fileBrowserFt.toggleSort(group, 'size');
      expect(rows()).toEqual(['docs', 'b.txt', 'c.pdf', 'a.txt']);
      expect(browser()?.columns.find((column) => column.sort)).toMatchObject({ key: 'size', sort: 'desc' });

      workbench.fileBrowserFt.toggleSort(group, 'nonsense');
      expect(workbench.fileBrowserFt.sortOf(group)).toEqual({ key: 'size', direction: 'desc' });
    });

    it('filters the listing, says how many are left, and explains an empty result', () => {
      workbench.fileBrowserFt.setFilter(group, '.TXT');
      expect(rows()).toEqual(['a.txt', 'b.txt']);
      expect(browser()).toMatchObject({ filterText: '.TXT', summary: '2 of 4 items' });

      workbench.fileBrowserFt.setFilter(group, 'zzz');
      expect(browser()?.empty).toMatchObject({ title: "No items match 'zzz'", hint: 'Clear the filter to see all 4 items.' });
    });

    it('clears the filter when the panel goes to another folder', async () => {
      workbench.fileBrowserFt.setFilter(group, 'a');
      workbench.fileBrowserFt.openEntry(group, 'docs');
      await answerListing('docs', []);
      expect(workbench.fileBrowserFt.filterOf(group)).toBe('');
    });

    it('selects all, none, and the opposite of what was selected', () => {
      workbench.fileBrowserFt.selectAll(group);
      expect(workbench.editorGroupsFt.stateOf(group)?.selection).toEqual(['docs', 'a.txt', 'b.txt', 'c.pdf']);
      select('a.txt');
      workbench.fileBrowserFt.invertSelection(group);
      expect(workbench.editorGroupsFt.stateOf(group)?.selection).toEqual(['docs', 'b.txt', 'c.pdf']);
      workbench.fileBrowserFt.selectNone(group);
      expect(workbench.editorGroupsFt.stateOf(group)?.selection).toEqual([]);
      http.match(() => true).forEach((request) => request.flush(fsEnvelope(fsDetails('x'))));
    });
  });

  describe('the toolbar and the path bar', () => {
    it('offers Back and Forward once there is somewhere to go', async () => {
      const disabled = () => browser()?.toolbarActions.filter((action) => action.disabled).map((action) => action.id);
      workbench.fileBrowserFt.openEntry(group, 'docs');
      await answerListing('docs', []);
      expect(disabled()).toEqual(['forward']);

      workbench.fileBrowserFt.runToolbarAction(group, 'back');
      expect(workbench.editorGroupsFt.pathOf(group)).toBe('');
      expect(disabled()).toEqual(['back', 'up']);
      workbench.fileBrowserFt.runToolbarAction(group, 'forward');
      expect(workbench.editorGroupsFt.pathOf(group)).toBe('docs');
    });

    it('gives the path bar the folder as a path, and goes where one is typed', async () => {
      expect(browser()?.location).toBe('/');

      const going = workbench.fileBrowserFt.goToLocation(group, ' \\docs\\ ');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      await going;
      await answerListing('docs', [fsEntry('docs/x.md')]);
      expect(workbench.editorGroupsFt.pathOf(group)).toBe('docs');
      expect(browser()?.location).toBe('/docs');
    });

    it('shows a typed file in its folder, selected', async () => {
      const going = workbench.fileBrowserFt.goToLocation(group, '/docs/x.md');
      http.expectOne(detailsUrl('docs/x.md')).flush(fsEnvelope(fsDetails('docs/x.md')));
      await going;
      await answerListing('docs', [fsEntry('docs/x.md')]);
      expect(workbench.editorGroupsFt.stateOf(group)).toMatchObject({ path: 'docs', selection: ['docs/x.md'] });
    });

    /** PRD 004, §4.1 — `s:\\tronog` typed on a disk that ignores case: gone to as the disk spells it. */
    it('goes to a typed path as the backend spells it', async () => {
      const going = workbench.fileBrowserFt.goToLocation(group, 's:\\tronog');
      http.expectOne(detailsUrl('s:/tronog')).flush(fsEnvelope(fsDirectoryDetails('S:/Tronog')));
      await going;
      await answerListing('S:/Tronog', [fsEntry('S:/Tronog/x.md')]);
      expect(workbench.editorGroupsFt.pathOf(group)).toBe('S:/Tronog');

      const file = workbench.fileBrowserFt.goToLocation(group, 's:/tronog/X.MD');
      http.expectOne(detailsUrl('s:/tronog/X.MD')).flush(fsEnvelope(fsDetails('S:/Tronog/x.md')));
      await file;
      expect(workbench.editorGroupsFt.stateOf(group)).toMatchObject({ path: 'S:/Tronog', selection: ['S:/Tronog/x.md'] });
    });

    /** PRD 004, §4.2 — the path bar suggests what fits as it is typed in. */
    it('suggests places in the folder typed in, reading it once, and nothing once it has gone somewhere', async () => {
      workbench.fileBrowserFt.locationInput(group, '/DOCS/X');
      await answerListing('DOCS', [fsEntry('docs/x.md'), fsEntry('docs/other.md')]);
      expect(browser()?.locationSuggestions).toEqual([{ value: '/docs/x.md', label: 'x.md', icon: 'file' }]);
      // A folder typed with a slash: the folder itself first, so Enter goes to it (PRD 004, §4.2).
      workbench.fileBrowserFt.locationInput(group, '/DOCS/');
      expect(browser()?.locationSuggestions?.map((suggestion) => suggestion.label)).toEqual(['DOCS', 'other.md', 'x.md']);
      expect(browser()?.locationSuggestions?.[0]).toMatchObject({ value: '/DOCS', folder: true });

      const going = workbench.fileBrowserFt.goToLocation(group, '/docs/x.md');
      expect(browser()?.locationSuggestions).toEqual([]);
      http.expectOne(detailsUrl('docs/x.md')).flush(fsEnvelope(fsDetails('docs/x.md')));
      await going;
      http.match(() => true);
    });

    it('says so when there is nothing at a typed path, and refuses ..', async () => {
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
      const going = workbench.fileBrowserFt.goToLocation(group, '/nope');
      http
        .expectOne(detailsUrl('nope'))
        .flush({ error: { code: 'NOT_FOUND', message: 'Path not found' } }, { status: 404, statusText: 'Not Found' });
      await going;
      await workbench.fileBrowserFt.goToLocation(group, '/docs/../etc');

      expect(message.mock.calls.map(([options]) => options.message)).toEqual([
        "There is no file or folder at '/nope'.",
        "'/docs/../etc' is not a path this panel can go to.",
      ]);
      expect(workbench.editorGroupsFt.pathOf(group)).toBe('');
    });
  });

  describe('opening outside the app', () => {
    it('opens what the app cannot show with the system, and previews the rest', () => {
      const open = vi.spyOn(workbench.systemOpenFt, 'open').mockResolvedValue();
      const preview = vi.spyOn(workbench.filePreviewFt, 'open').mockImplementation(() => undefined);

      workbench.fileBrowserFt.openEntry(group, 'c.pdf');
      workbench.fileBrowserFt.openEntry(group, 'a.txt');

      expect(open).toHaveBeenCalledWith('c.pdf');
      expect(preview).toHaveBeenCalledWith('a.txt');
      expect(preview).not.toHaveBeenCalledWith('c.pdf');
    });

    it('names things as the browser can do them, and offers no Reveal there', () => {
      expect(workbench.systemOpenFt.openLabel()).toBe('Open in New Browser Tab');
      expect(workbench.systemOpenFt.canReveal()).toBe(false);
      expect(workbench.commandsFt.isEnabled('file.reveal', workbench.commandsFt.entryTarget(group, 'a.txt'))).toBe(false);
    });
  });

  describe('rename, new folder, new file', () => {
    it('checks a name as it is typed', () => {
      expect(nameProblem('  ')).toMatch(/must be provided/);
      expect(nameProblem('..')).toMatch(/not a valid name/);
      expect(nameProblem('a/b')).toMatch(/cannot contain/);
      expect(nameProblem('ok.txt')).toBeNull();
      expect(relocatePath('docs/a/b', 'docs/a', 'docs/z')).toBe('docs/z/b');
      expect(relocatePath('docs/ab', 'docs/a', 'docs/z')).toBe('docs/ab');
    });

    it('renames, asking with the stem selected, and selects the entry under its new name', async () => {
      const prompt = vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('renamed.txt');
      const rename = vi.spyOn(workbench.fileSystem.editFt, 'rename').mockResolvedValue(fsDetails('renamed.txt'));

      const renaming = workbench.fileEditFt.rename('a.txt', group);
      await settled();
      await answerListing('', [fsDirectory('docs'), fsEntry('renamed.txt'), fsEntry('b.txt'), fsEntry('c.pdf')]);
      await renaming;

      expect(prompt.mock.calls[0]?.[0]).toMatchObject({ value: 'a.txt', selection: [0, 1], confirmLabel: 'Rename' });
      expect(rename).toHaveBeenCalledWith('a.txt', 'renamed.txt');
      expect(workbench.editorGroupsFt.stateOf(group)).toMatchObject({ selection: ['renamed.txt'], focusedEntryId: 'renamed.txt' });
      expect(workbench.undoFt.label()).toBe('Undo Rename');
    });

    it('asks again, saying why, when the name is taken', async () => {
      const prompt = vi.spyOn(workbench.modal, 'prompt').mockResolvedValueOnce('b.txt').mockResolvedValueOnce(null);
      vi.spyOn(workbench.fileSystem.editFt, 'rename').mockRejectedValue(new FsError('Target already exists', 409, 'CONFLICT'));

      await workbench.fileEditFt.rename('a.txt', group);

      expect(prompt).toHaveBeenCalledTimes(2);
      expect(prompt.mock.calls[1]?.[0]).toMatchObject({
        value: 'b.txt',
        detail: "A file or folder 'b.txt' already exists here. Please choose a different name.",
      });
      expect(workbench.undoFt.canUndo()).toBe(false);
    });

    it('keeps a panel on a renamed folder, under its new name', async () => {
      workbench.fileBrowserFt.openEntry(group, 'docs');
      await answerListing('docs', [fsEntry('docs/x.md')]);
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('papers');
      vi.spyOn(workbench.fileSystem.editFt, 'rename').mockResolvedValue(fsDirectoryDetails('papers'));

      const renaming = workbench.fileEditFt.rename('docs', null);
      await settled();
      await answerListing('', [fsDirectory('papers')]);
      http.match(listUrl('papers')).forEach((request) => request.flush(fsEnvelope(fsListing('papers', []))));
      await renaming;

      const state = workbench.editorGroupsFt.stateOf(group);
      expect(state?.path).toBe('papers');
      expect(state?.tabs[0]).toMatchObject({ path: 'papers', label: 'papers' });
    });

    it('makes a folder in the panel’s folder, then selects it', async () => {
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('Stuff');
      const create = vi.spyOn(workbench.fileSystem.editFt, 'createFolder').mockResolvedValue(fsDirectoryDetails('Stuff'));

      workbench.fileBrowserFt.runToolbarAction(group, 'new-folder');
      await settled();
      await answerListing('', [...ROOT, fsDirectory('Stuff')]);

      expect(create).toHaveBeenCalledWith('', 'Stuff');
      expect(workbench.editorGroupsFt.stateOf(group)?.selection).toEqual(['Stuff']);
      expect(workbench.undoFt.label()).toBe('Undo New Folder');
    });

    it('Ctrl+Shift+N and F2 in a panel ask for a folder name and a new name', () => {
      const folder = vi.spyOn(workbench.fileEditFt, 'createFolder').mockResolvedValue();
      const rename = vi.spyOn(workbench.fileEditFt, 'rename').mockResolvedValue();

      workbench.panelKeyboardFt.run(group, { command: 'new-folder', entryId: null });
      workbench.fileBrowserFt.selectEntry(group, 'a.txt');
      workbench.functionKeysFt.run('F2');

      expect(folder).toHaveBeenCalledWith('', group);
      expect(rename).toHaveBeenCalledWith('a.txt', group);
    });
  });

  describe('undo', () => {
    it('renames back', async () => {
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('z.txt');
      const rename = vi.spyOn(workbench.fileSystem.editFt, 'rename').mockResolvedValue(fsDetails('z.txt'));
      const renaming = workbench.fileEditFt.rename('a.txt', group);
      await settled();
      await answerListing('', ROOT);
      await renaming;

      const undoing = workbench.undoFt.undo();
      await settled();
      await answerListing('', ROOT);
      await undoing;

      expect(rename.mock.calls).toEqual([
        ['a.txt', 'z.txt'],
        ['z.txt', 'a.txt'],
      ]);
      expect(workbench.undoFt.canUndo()).toBe(false);
    });

    it('puts moved entries back where they came from, one rename each, newest first', async () => {
      const rename = vi.spyOn(workbench.fileSystem.editFt, 'rename').mockResolvedValue(fsDetails('x'));
      vi.spyOn(workbench.fsDataFt, 'reloadListing').mockResolvedValue();
      workbench.undoFt.recordJob(
        job({ kind: 'move', outcome: [{ source: 'a.txt', target: 'docs/a.txt' }, { source: 'b.txt', target: 'docs/b copy.txt' }] }),
        false,
      );
      expect(workbench.undoFt.label()).toBe('Undo Move');

      await workbench.undoFt.undo();

      expect(rename.mock.calls).toEqual([
        ['docs/b copy.txt', 'b.txt'],
        ['docs/a.txt', 'a.txt'],
      ]);
    });

    it('takes back a copy by trashing the copies, after asking', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(job({ kind: 'trash' }));
      workbench.undoFt.recordJob(job({ kind: 'copy', outcome: [{ source: 'a.txt', target: 'docs/a.txt' }] }), false);

      await workbench.undoFt.undo();

      expect(start).toHaveBeenCalledWith({ kind: 'trash', paths: ['docs/a.txt'], errors: 'ask' });
      // Undoing is not itself undoable.
      await settled();
      expect(workbench.undoFt.canUndo()).toBe(false);
    });

    it('restores from a trash that can, and says where to look in one that cannot', async () => {
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(job({ kind: 'restore' }));
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();

      workbench.undoFt.recordJob(job({ kind: 'trash', outcome: [{ source: 'a.txt', target: 'a.txt.k1' }] }), true);
      await workbench.undoFt.undo();
      expect(start).toHaveBeenCalledWith({ kind: 'restore', ids: ['a.txt.k1'], errors: 'ask' });

      workbench.undoFt.recordJob(job({ kind: 'trash', outcome: [] }), false);
      workbench.undoFt.recordJob(job({ kind: 'delete' }), false);
      await workbench.undoFt.undo();
      await workbench.undoFt.undo();
      expect(message.mock.calls.map(([options]) => options.message)).toEqual([
        'The last change — delete — cannot be undone.',
        'The last change — move to trash — cannot be undone.',
      ]);
    });

    it('records what a job the user started did, once it ends', async () => {
      vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      vi.spyOn(workbench.fileSystem.operationsFt, 'operationsInfo').mockResolvedValue({ trash: 'server', canRestore: true });
      vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(
        job({ kind: 'trash', outcome: [{ source: 'a.txt', target: 'a.txt.k1' }] }),
      );
      vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockResolvedValue(undefined);

      await workbench.operationsFt.trash(['a.txt']);
      await settled();

      expect(workbench.undoFt.label()).toBe('Undo Move to Trash');
    });
  });

  describe('delete permanently', () => {
    it('Shift+Delete asks, saying it cannot be undone, then deletes', async () => {
      const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
      const start = vi.spyOn(workbench.fileSystem.operationsFt, 'start').mockResolvedValue(job({ kind: 'delete' }));
      vi.spyOn(workbench.fsDataFt, 'invalidateListing').mockResolvedValue(undefined);

      workbench.panelKeyboardFt.run(group, { command: 'delete-permanently', entryId: 'a.txt' });
      await settled();

      expect(confirm.mock.calls[0]?.[0]).toMatchObject({
        message: "Are you sure you want to permanently delete 'a.txt'?",
        detail: 'This action is irreversible!',
      });
      expect(start).toHaveBeenCalledWith({ kind: 'delete', paths: ['a.txt'], errors: 'ask' });
    });
  });

  describe('commands and context menus', () => {
    const labels = () => (workbench.contextMenuFt.menu()?.items ?? []).map((item) => item.label);

    it('a right-click on a file offers what can be done to it, and runs it on that file', () => {
      const rename = vi.spyOn(workbench.fileEditFt, 'rename').mockResolvedValue();
      workbench.contextMenuFt.openInPanel(group, { target: 'a.txt', x: 10, y: 20 });

      expect(workbench.contextMenuFt.menu()).toMatchObject({ x: 10, y: 20 });
      expect(labels()).toEqual([
        'Open',
        'Open in Other Panel',
        'Open in New Browser Tab',
        'Open Containing Folder',
        'Cut',
        'Copy',
        'Copy Path',
        'Download',
        'Compress…',
        'Extract Here',
        'Extract To…',
        'Rename…',
        'Copy To…',
        'Move To…',
        'Move to Trash',
        'Delete Permanently…',
      ]);
      expect(workbench.contextMenuFt.menu()?.items.find((item) => item.id === 'file.reveal')?.disabled).toBe(true);

      workbench.contextMenuFt.run('file.rename');
      expect(rename).toHaveBeenCalledWith('a.txt', group);
      expect(workbench.contextMenuFt.menu()).toBeNull();
    });

    it('acts on the whole selection when the entry is part of it', () => {
      select('a.txt', 'b.txt');
      workbench.contextMenuFt.openInPanel(group, { target: 'b.txt', x: 0, y: 0 });
      expect(workbench.contextMenuFt.menu()?.target.paths).toEqual(['a.txt', 'b.txt']);
      expect(labels()).not.toContain('Rename…');
    });

    it('a right-click on blank space is about the folder: new entries go there, paste waits for the clipboard', () => {
      workbench.contextMenuFt.openInPanel(group, { target: null, x: 0, y: 0 });
      const item = (id: string) => workbench.contextMenuFt.menu()?.items.find((candidate) => candidate.id === id);
      expect(item('file.newFolder')?.disabled).toBeUndefined();
      expect(item('edit.paste')?.disabled).toBe(true);
      expect(workbench.contextMenuFt.menu()?.target).toEqual({ groupId: group, paths: [], folder: '' });
    });

    it('a folder takes pastes and new entries itself', () => {
      workbench.fileClipboardFt.putPaths('copy', ['a.txt']);
      const paste = vi.spyOn(workbench.fileClipboardFt, 'pasteInto').mockResolvedValue();
      workbench.contextMenuFt.openInPanel(group, { target: 'docs', x: 0, y: 0 });
      workbench.contextMenuFt.run('edit.paste');
      expect(paste).toHaveBeenCalledWith('docs');
    });

    it('offers the workspace root in the tree nothing to rename or delete, and tabs their own', () => {
      workbench.contextMenuFt.openInTree({ target: '', x: 0, y: 0 });
      expect(labels()).not.toContain('Rename…');
      workbench.contextMenuFt.openOnTab(group, { target: 'tab-root', x: 0, y: 0 });
      expect(labels().slice(0, 3)).toEqual(['Close', 'Close Others', 'Close to the Right']);
    });
  });

  describe('auto-refresh', () => {
    it('asks what changed among the folders on screen, and reads those again', async () => {
      const watch = vi.spyOn(workbench.fileSystem.readFt, 'watch').mockResolvedValue({ watchId: 'w1', changed: [] });
      await workbench.autoRefreshFt.poll();
      expect(watch).toHaveBeenLastCalledWith(null, ['']);

      watch.mockResolvedValue({ watchId: 'w1', changed: [''] });
      await workbench.autoRefreshFt.poll();
      expect(watch).toHaveBeenLastCalledWith('w1', ['']);
      await answerListing('', [...ROOT, fsEntry('new.txt')]);
      expect(rows()).toContain('new.txt');
      workbench.autoRefreshFt.stop();
    });

    it('lets a folder that leaves the screen go stale, and reads it again when it is back', async () => {
      vi.spyOn(workbench.fileSystem.readFt, 'watch').mockResolvedValue({ watchId: 'w1', changed: [] });
      workbench.fileBrowserFt.openEntry(group, 'docs');
      await answerListing('docs', []);
      await workbench.autoRefreshFt.poll();
      workbench.fileBrowserFt.runToolbarAction(group, 'back');
      await workbench.autoRefreshFt.poll();

      workbench.fileBrowserFt.runToolbarAction(group, 'forward');
      await answerListing('docs', [fsEntry('docs/new.md')]);
      expect(rows()).toEqual(['docs/new.md']);
      workbench.autoRefreshFt.stop();
    });

    it('stops for good against a backend that does not know the command', async () => {
      vi.spyOn(workbench.fileSystem.readFt, 'watch').mockRejectedValue(new FsError('Not found', 404, 'NOT_FOUND'));
      const timers = vi.spyOn(globalThis, 'setTimeout');
      workbench.autoRefreshFt.start();
      timers.mockClear();
      await workbench.autoRefreshFt.poll();
      expect(timers).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('searches once typing pauses, drops an answer to an older question, and shows results by name', async () => {
      vi.useFakeTimers();
      const search = vi
        .spyOn(workbench.fileSystem.readFt, 'search')
        .mockResolvedValue({ path: '', query: 'rep', entries: [fsEntry('docs/report.md')], truncated: false, scanned: 9 });

      workbench.searchFt.setQuery('re');
      workbench.searchFt.setQuery('rep');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await vi.runAllTimersAsync();

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('', 'rep', 500);
      expect(workbench.searchFt.nodes()).toEqual([
        expect.objectContaining({ id: 'docs/report.md', label: 'report.md', meta: '/docs' }),
      ]);
      expect(workbench.searchFt.summary()).toBe('1 result');
    });

    it('opens on Ctrl+Shift+F, and shows a result in its folder', async () => {
      const token = workbench.searchFt.focusToken();
      const event = new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, cancelable: true });
      workbench.keybindingsFt.handleShortcut(event);
      expect(event.defaultPrevented).toBe(true);
      expect(workbench.searchFt.focusToken()).toBe(token + 1);
      expect(workbench.chromeFt.sidebarView()).toBe('search');

      workbench.searchFt.reveal('docs/report.md');
      await answerListing('docs', [fsEntry('docs/report.md')]);
      expect(workbench.editorGroupsFt.stateOf(group)).toMatchObject({ path: 'docs', selection: ['docs/report.md'] });

      // The File Manager button goes back to its Explorer, as the Explorer button did (PRD 001, §1.1).
      workbench.chromeFt.selectActivity('file-manager');
      expect(workbench.chromeFt.sidebarView()).toBe('explorer');
    });
  });
});
