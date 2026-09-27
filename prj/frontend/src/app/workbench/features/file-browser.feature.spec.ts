import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiFileRow } from '@tr-file/ui';
import {
  detailsUrl,
  downloadUrl,
  fsDetails,
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsErrorBody,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { FOLDER_VIEWS_KEY, FOLDER_VIEWS_LIMIT, FolderViewsFeature } from './folder-views.feature';

const ROOT_ENTRIES = [
  fsDirectory('docs'),
  fsEntry('README.md', { size: 3482 }),
  fsEntry('main.ts', { size: 612 }),
];

describe('FileBrowserFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    http.verify();
  });

  const rowOf = (groupId: string, entryId: string): UiFileRow | undefined =>
    workbench.fileBrowserFt.browser(groupId)?.rows.find((row) => row.id === entryId);

  /** Starts the editor area and answers the seeded group's listing. */
  const start = async (entries = ROOT_ENTRIES): Promise<void> => {
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', entries)));
    await settled();
  };

  describe('empty states', () => {
    it('reports a folder that could not be read, with the server message', async () => {
      workbench.editorGroupsFt.start();
      http
        .expectOne(listUrl(''))
        .flush(fsErrorBody('FORBIDDEN', 'Outside the root'), { status: 403, statusText: 'Forbidden' });
      await settled();

      expect(workbench.fileBrowserFt.browser('group-root')?.empty).toEqual({
        icon: 'alert-triangle',
        title: 'Could not open this folder',
        hint: 'Outside the root',
      });
    });

    it('offers to fill an empty folder', async () => {
      await start([]);

      expect(workbench.fileBrowserFt.browser('group-root')?.empty).toMatchObject({
        title: 'This folder is empty',
        hint: 'Drop files here to upload them',
      });
      expect(workbench.fileBrowserFt.browser('group-root')?.summary).toBe('0 items');
    });

    it('shows no placeholder while a folder with contents is open', async () => {
      await start();

      expect(workbench.fileBrowserFt.browser('group-root')?.empty).toBeUndefined();
      expect(workbench.editorGroupsFt.group('group-root')?.empty).toBeUndefined();
    });
  });

  describe('openEntry()', () => {
    it('navigates the group into a directory, moving tab, path and breadcrumbs', async () => {
      await start();

      workbench.fileBrowserFt.openEntry('group-root', 'docs');

      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsEntry('docs/NOTES.md')])));
      await settled();

      const group = workbench.editorGroupsFt.group('group-root');
      const browser = workbench.fileBrowserFt.browser('group-root');
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('docs');
      expect(group?.tabs[0]).toMatchObject({ id: 'tab-root', label: 'docs', active: true });
      expect(browser?.breadcrumbs.map((crumb) => crumb.label)).toEqual(['tr-file', 'docs']);
      expect(browser?.rows.map((row) => row.id)).toEqual(['docs/NOTES.md']);
    });

    it('opens a file in a read-only tab instead of downloading it', async () => {
      await start();

      workbench.fileBrowserFt.openEntry('group-root', 'README.md');

      // Selecting it describes it on the right; opening it reads the bytes.
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      http
        .expectOne(downloadUrl('README.md'))
        .flush(new Blob(['# Title'], { type: 'text/markdown' }));
      await settled();

      const group = workbench.editorGroupsFt.group('group-root');
      const browser = workbench.fileBrowserFt.browser('group-root');
      expect(group?.tabs.map((tab) => tab.label)).toEqual(['tr-file', 'README.md']);
      expect(group?.tabs[1]).toMatchObject({ active: true, icon: 'file' });
      // A file tab lists nothing and offers no list/grid switch.
      expect(browser?.rows).toEqual([]);
      expect(browser?.showViewSwitch).toBeUndefined();
      expect(browser?.document).toMatchObject({ path: 'README.md', kind: 'markdown' });
      expect(browser?.document?.html).toContain('<h1>Title</h1>');
    });

    it('ignores an entry the listing does not contain', async () => {
      await start();

      workbench.fileBrowserFt.openEntry('group-root', 'nope');

      http.expectNone(() => true);
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
    });
  });

  describe('runToolbarAction()', () => {
    it('offers Back, Forward, Up, Refresh, New File, New Folder and Upload — at the root, with nowhere to go back or up to', async () => {
      await start();

      const actions = workbench.fileBrowserFt.browser('group-root')?.toolbarActions ?? [];
      expect(actions.map((action) => action.id)).toEqual(['back', 'forward', 'up', 'refresh', 'new-file', 'new-folder', 'upload']);
      expect(actions.filter((action) => action.disabled).map((action) => action.id)).toEqual(['back', 'forward', 'up']);
    });

    it('up walks the group to the parent directory', async () => {
      await start();
      workbench.fileBrowserFt.openEntry('group-root', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsDirectory('docs/prd')])));
      await settled();
      workbench.fileBrowserFt.openEntry('group-root', 'docs/prd');
      http.expectOne(listUrl('docs/prd')).flush(fsEnvelope(fsListing('docs/prd')));
      await settled();

      workbench.fileBrowserFt.runToolbarAction('group-root', 'up');

      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('docs');
      expect(workbench.editorGroupsFt.group('group-root')?.tabs[0]?.label).toBe('docs');
      // `docs` is still cached, so walking back up costs no request.
      http.expectNone(listUrl('docs'));
    });

    it('up does nothing at the root', async () => {
      await start();

      workbench.fileBrowserFt.runToolbarAction('group-root', 'up');

      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
      http.expectNone(() => true);
    });

    it('refresh re-reads the open directory', async () => {
      await start();

      workbench.fileBrowserFt.runToolbarAction('group-root', 'refresh');

      http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsEntry('new.ts')])));
      await settled();

      expect(workbench.fileBrowserFt.browser('group-root')?.rows.map((row) => row.id)).toEqual(['new.ts']);
    });

    it('upload asks the component for the file picker', async () => {
      await start();

      workbench.fileBrowserFt.runToolbarAction('group-root', 'upload');

      expect(workbench.uploadRequest()).toEqual({ groupId: 'group-root', path: '' });
    });

    it('ignores an unknown action and an unknown group', async () => {
      await start();

      workbench.fileBrowserFt.runToolbarAction('group-root', 'sort');
      workbench.fileBrowserFt.runToolbarAction('nope', 'refresh');

      http.expectNone(() => true);
      expect(workbench.uploadRequest()).toBeNull();
    });
  });

  /** PRD 004, §1.2 — one entry or many, from any view. */
  describe('setSelection()', () => {
    it('selects many, keeps the cursor on one, and describes that one', async () => {
      await start();

      workbench.fileBrowserFt.setSelection('group-root', { selected: ['docs', 'main.ts'], focused: 'main.ts' });
      http.expectOne(detailsUrl('main.ts')).flush(fsEnvelope(fsDetails('main.ts')));
      await settled();

      const rows = workbench.fileBrowserFt.browser('group-root')?.rows ?? [];
      expect(rows.filter((row) => row.selected).map((row) => row.id)).toEqual(['docs', 'main.ts']);
      expect(rows.find((row) => row.focused)?.id).toBe('main.ts');
      expect(workbench.selectedEntryId()).toBe('main.ts');
      // The grid shows the same selection.
      expect(workbench.fileBrowserFt.browser('group-root')?.items.filter((item) => item.selected)).toHaveLength(2);
    });

    it('keeps the cursor and the sidebar where they were when a box caught nothing', async () => {
      await start();
      workbench.fileBrowserFt.setSelection('group-root', { selected: ['main.ts'], focused: 'main.ts' });
      http.expectOne(detailsUrl('main.ts')).flush(fsEnvelope(fsDetails('main.ts')));
      await settled();

      workbench.fileBrowserFt.setSelection('group-root', { selected: [], focused: null });

      expect(workbench.fileBrowserFt.browser('group-root')?.rows.filter((row) => row.selected)).toEqual([]);
      expect(rowOf('group-root', 'main.ts')?.focused).toBe(true);
      expect(workbench.selectedEntryId()).toBe('main.ts');
      http.expectNone(() => true);
    });
  });

  describe('selectEntry()', () => {
    it('updates the group selection and the workbench selection', async () => {
      await start();

      workbench.fileBrowserFt.selectEntry('group-root', 'README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await settled();

      expect(workbench.selectedEntryId()).toBe('README.md');
      expect(workbench.activeGroupId()).toBe('group-root');
      expect(rowOf('group-root', 'README.md')).toMatchObject({ selected: true, focused: true });
      expect(rowOf('group-root', 'main.ts')?.selected).toBeUndefined();
      expect(
        workbench.fileBrowserFt
          .browser('group-root')
          ?.items.filter((item) => item.selected)
          .map((item) => item.id),
      ).toEqual(['README.md']);
    });

    it('replaces the previous selection rather than adding to it', async () => {
      await start();

      workbench.fileBrowserFt.selectEntry('group-root', 'README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      workbench.fileBrowserFt.selectEntry('group-root', 'main.ts');
      http.expectOne(detailsUrl('main.ts')).flush(fsEnvelope(fsDetails('main.ts')));
      await settled();

      expect(rowOf('group-root', 'README.md')?.selected).toBeUndefined();
      expect(rowOf('group-root', 'main.ts')?.selected).toBe(true);
    });

    it('dims the selection of a group that is not active', async () => {
      await start();
      workbench.fileBrowserFt.selectEntry('group-root', 'README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await settled();

      workbench.activeGroupId.set('somewhere-else');

      expect(rowOf('group-root', 'README.md')?.inactiveSelected).toBe(true);
      expect(rowOf('group-root', 'README.md')?.selected).toBeUndefined();
      expect(rowOf('group-root', 'README.md')?.focused).toBeUndefined();
    });
  });

  describe('openBreadcrumb()', () => {
    it('walks the group back to the workspace root', async () => {
      await start();
      workbench.fileBrowserFt.openEntry('group-root', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs')));
      await settled();

      workbench.fileBrowserFt.openBreadcrumb('group-root', 'root');

      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
      expect(workbench.editorGroupsFt.group('group-root')?.tabs[0]?.label).toBe('tr-file');
      http.expectNone(listUrl(''));
    });
  });

  /** PRD 004, §1.3.1 — the view and the order are the folder's, kept in the client's storage. */
  describe('views and orders per folder', () => {
    const DOCS = [fsEntry('docs/b.md', { size: 10 }), fsEntry('docs/a.md', { size: 90 })];

    /** Moves a group into a folder and answers its listing. */
    const enter = async (groupId: string, path: string, entries = DOCS): Promise<void> => {
      workbench.fileBrowserFt.navigateTo(groupId, path, path.split('/').at(-1) ?? path);
      for (const request of http.match(listUrl(path))) {
        request.flush(fsEnvelope(fsListing(path, entries)));
      }
      await settled();
    };
    const view = (groupId: string) => workbench.fileBrowserFt.browser(groupId)?.view;
    const names = (groupId: string) => workbench.fileBrowserFt.browser(groupId)?.rows.map((row) => row.name);

    it('switches every panel showing the folder, and no other', async () => {
      await start();
      workbench.editorGroupsFt.runAction('group-root', 'split-right');
      const second = workbench.panelLayoutFt.groupIds()[1] as string;

      workbench.fileBrowserFt.setView('group-root', 'grid');
      expect(view('group-root')).toBe('grid');
      expect(view(second)).toBe('grid');

      await enter(second, 'docs');
      workbench.fileBrowserFt.setView(second, 'tree');
      expect(view(second)).toBe('tree');
      expect(view('group-root')).toBe('grid');
    });

    it('shows each folder the way it was left, and a new one as its panel last did', async () => {
      await start();
      workbench.fileBrowserFt.setView('group-root', 'grid');
      workbench.fileBrowserFt.toggleSort('group-root', 'size');

      // Nothing chosen for docs yet: it looks as the panel last did.
      await enter('group-root', 'docs');
      expect(view('group-root')).toBe('grid');
      workbench.fileBrowserFt.setView('group-root', 'list');
      workbench.fileBrowserFt.setSort('group-root', { key: 'name', direction: 'desc' });
      expect(names('group-root')).toEqual(['b.md', 'a.md']);

      workbench.fileBrowserFt.navigateTo('group-root', '', 'tr-file');
      await settled();
      expect(view('group-root')).toBe('grid');
      expect(workbench.fileBrowserFt.sortOf('group-root')).toEqual({ key: 'size', direction: 'asc' });

      workbench.fileBrowserFt.navigateTo('group-root', 'docs', 'docs');
      await settled();
      expect(view('group-root')).toBe('list');
      expect(workbench.fileBrowserFt.sortOf('group-root')).toEqual({ key: 'name', direction: 'desc' });
      expect(workbench.commandsFt.menuItem('view.list').checked).toBe(true);
    });

    it('keeps them in the client storage, per backend, and reads them on the next start', async () => {
      await start();
      await enter('group-root', 'docs');
      workbench.fileBrowserFt.setView('group-root', 'tree');
      workbench.fileBrowserFt.toggleSort('group-root', 'modified');

      const kept = JSON.parse(localStorage.getItem(`${FOLDER_VIEWS_KEY}:local`) ?? '[]') as { path: string }[];
      expect(kept).toEqual([expect.objectContaining({ path: 'docs', view: 'tree', sort: { key: 'modified', direction: 'asc' } })]);

      const next = new FolderViewsFeature(workbench);
      expect(next.viewOf('docs')).toBe('tree');
      expect(next.sortOf('docs')).toEqual({ key: 'modified', direction: 'asc' });
      expect(next.viewOf('')).toBeUndefined();
    });

    it('lets go of what storage holds that makes no sense, and of the oldest past the limit', () => {
      localStorage.setItem(
        `${FOLDER_VIEWS_KEY}:local`,
        JSON.stringify([
          { path: 'a', view: 'grid', at: 2 },
          { path: 'b', view: 'sideways', at: 3 },
          { path: 'c', sort: { key: 'colour', direction: 'asc' }, at: 4 },
          { view: 'grid' },
          'junk',
          { path: 'd', sort: { key: 'size', direction: 'desc' }, at: 1 },
        ]),
      );
      const views = new FolderViewsFeature(workbench);
      expect(views.viewOf('a')).toBe('grid');
      expect(views.viewOf('b')).toBeUndefined();
      expect(views.sortOf('c')).toBeUndefined();
      expect(views.sortOf('d')).toEqual({ key: 'size', direction: 'desc' });

      for (let index = 0; index < FOLDER_VIEWS_LIMIT; index++) {
        views.rememberView(`f${index}`, 'list');
      }
      expect(views.viewOf('a')).toBeUndefined();
      expect(views.viewOf(`f${FOLDER_VIEWS_LIMIT - 1}`)).toBe('list');
    });

    it('follows a folder that is renamed, and what is in it', () => {
      const views = workbench.folderViewsFt;
      views.rememberView('docs', 'grid');
      views.rememberView('docs/prd', 'tree');
      views.relocate((path) => (path === 'docs' || path.startsWith('docs/') ? `notes${path.slice(4)}` : path));
      expect(views.viewOf('notes')).toBe('grid');
      expect(views.viewOf('notes/prd')).toBe('tree');
      expect(views.viewOf('docs')).toBeUndefined();
    });

    it('remembers nothing for a file shown in a panel', async () => {
      await start();
      workbench.fileBrowserFt.openFile('group-root', 'README.md', 'README.md');
      for (const request of http.match(() => true)) {
        request.flush(new Blob(['# hi']));
      }
      await settled();
      workbench.fileBrowserFt.setView('group-root', 'grid');
      expect(workbench.folderViewsFt.viewOf('README.md')).toBeUndefined();
    });
  });

  /** PRD 003, §1 — a link to a folder behaves as the folder it leads to. */
  describe('symlinked folders', () => {
    const LINKED = [
      fsEntry('shortcut', { type: 'symlink', targetType: 'directory', size: 12 }),
      fsEntry('note-link', { type: 'symlink', targetType: 'file', size: 9 }),
    ];

    it('shows a link to a folder as a folder', async () => {
      await start([...ROOT_ENTRIES, ...LINKED]);

      expect(rowOf('group-root', 'shortcut')).toMatchObject({ icon: 'folder', cells: { size: '—', type: 'Folder link' } });
      expect(rowOf('group-root', 'note-link')).toMatchObject({ icon: 'file', cells: { type: 'Link' } });
    });

    it('navigates into it rather than previewing it', async () => {
      await start([...ROOT_ENTRIES, ...LINKED]);

      workbench.fileBrowserFt.openEntry('group-root', 'shortcut');
      http.expectOne(listUrl('shortcut')).flush(fsEnvelope(fsListing('shortcut', [fsEntry('shortcut/inside.txt')])));
      await settled();

      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('shortcut');
      expect(workbench.editorGroupsFt.group('group-root')?.tabs).toHaveLength(1);
      http.expectNone(downloadUrl('shortcut'));
    });

    it('opens in place in the tree view', async () => {
      await start([...ROOT_ENTRIES, ...LINKED]);
      workbench.fileBrowserFt.setView('group-root', 'tree');

      expect(rowOf('group-root', 'shortcut')?.expandable).toBe(true);
      workbench.fileBrowserFt.toggleEntry('group-root', 'shortcut');
      http.expectOne(listUrl('shortcut')).flush(fsEnvelope(fsListing('shortcut', [])));
      await settled();

      expect(rowOf('group-root', 'shortcut')?.expanded).toBe(true);
    });
  });

  /** PRD 002, §4.1 — folders open in place, with the details view's columns. */
  describe('tree view', () => {
    const DOCS_ENTRIES = [fsDirectory('docs/prd'), fsEntry('docs/NOTES.md', { size: 1200 })];

    const treeRows = (groupId = 'group-root') =>
      (workbench.fileBrowserFt.browser(groupId)?.rows ?? []).map((row) => ({
        id: row.id,
        depth: row.depth,
        expanded: row.expanded,
      }));

    /** Starts on the root in tree view and opens `docs`, answering its listing. */
    const openDocs = async (): Promise<void> => {
      await start();
      workbench.fileBrowserFt.setView('group-root', 'tree');
      workbench.fileBrowserFt.toggleEntry('group-root', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();
    };

    it('lists the folder as the top level of a tree, files included', async () => {
      await start();

      workbench.fileBrowserFt.setView('group-root', 'tree');

      const browser = workbench.fileBrowserFt.browser('group-root');
      expect(browser?.view).toBe('tree');
      expect(browser?.columns.map((column) => column.key)).toEqual(['name', 'size', 'type', 'modified']);
      expect(browser?.rows.map((row) => [row.id, row.depth, row.expandable])).toEqual([
        ['docs', 0, true],
        ['main.ts', 0, false],
        ['README.md', 0, false],
      ]);
      expect(rowOf('group-root', 'README.md')?.cells).toMatchObject({ size: '3.4 KB', type: 'MD' });
    });

    it('opens a folder in place, fetching it, and shows its entries one level down', async () => {
      await start();
      workbench.fileBrowserFt.setView('group-root', 'tree');

      workbench.fileBrowserFt.toggleEntry('group-root', 'docs');

      // Open at once, spinning until the listing arrives.
      expect(rowOf('group-root', 'docs')).toMatchObject({ expanded: true, busy: true, icon: 'folder-open' });

      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(treeRows()).toEqual([
        { id: 'docs', depth: 0, expanded: true },
        { id: 'docs/prd', depth: 1, expanded: false },
        { id: 'docs/NOTES.md', depth: 1, expanded: undefined },
        { id: 'main.ts', depth: 0, expanded: undefined },
        { id: 'README.md', depth: 0, expanded: undefined },
      ]);
      expect(rowOf('group-root', 'docs')?.busy).toBeUndefined();
      // The panel is still on the root: opening in place is not navigating.
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
    });

    it('closes an open folder without fetching again', async () => {
      await openDocs();

      workbench.fileBrowserFt.toggleEntry('group-root', 'docs');
      expect(treeRows().map((row) => row.id)).toEqual(['docs', 'main.ts', 'README.md']);

      workbench.fileBrowserFt.toggleEntry('group-root', 'docs');
      http.expectNone(listUrl('docs'));
      expect(treeRows()).toHaveLength(5);
    });

    it('ignores a toggle on a file', async () => {
      await start();
      workbench.fileBrowserFt.setView('group-root', 'tree');

      workbench.fileBrowserFt.toggleEntry('group-root', 'README.md');

      http.expectNone(() => true);
      expect(rowOf('group-root', 'README.md')?.expanded).toBeUndefined();
    });

    /** Entries inside an open folder are as selectable and openable as the rest. */
    it('selects and opens entries inside an open folder', async () => {
      await openDocs();

      workbench.fileBrowserFt.selectEntry('group-root', 'docs/NOTES.md');
      http.expectOne(detailsUrl('docs/NOTES.md')).flush(fsEnvelope(fsDetails('docs/NOTES.md')));
      await settled();
      expect(rowOf('group-root', 'docs/NOTES.md')).toMatchObject({ selected: true, focused: true, depth: 1 });

      workbench.fileBrowserFt.openEntry('group-root', 'docs/prd');
      http.expectOne(listUrl('docs/prd')).flush(fsEnvelope(fsListing('docs/prd', [])));
      await settled();
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('docs/prd');
    });

    it('re-reads the open folders too on refresh', async () => {
      await openDocs();

      workbench.fileBrowserFt.runToolbarAction('group-root', 'refresh');

      http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();
    });

    /** Two panels on one folder are two places to work, each with its own tree. */
    it('keeps what is open per panel', async () => {
      await openDocs();

      workbench.editorGroupsFt.runAction('group-root', 'split-right');
      const second = workbench.panelLayoutFt.groupIds()[1] as string;

      expect(workbench.fileBrowserFt.browser(second)?.view).toBe('tree');
      expect(treeRows(second).map((row) => row.id)).toEqual(['docs', 'main.ts', 'README.md']);
      expect(treeRows()).toHaveLength(5);
    });

    it('opens nothing it is not showing', async () => {
      await openDocs();
      workbench.fileBrowserFt.setView('group-root', 'list');

      // In the flat list `docs/NOTES.md` is not on screen, so it is not there to open.
      workbench.fileBrowserFt.openEntry('group-root', 'docs/NOTES.md');

      http.expectNone(() => true);
      expect(workbench.fileBrowserFt.browser('group-root')?.rows.map((row) => row.id)).toEqual([
        'docs',
        'main.ts',
        'README.md',
      ]);
    });
  });

  describe('uploadInto()', () => {
    it('starts one upload per dropped file in the group directory', async () => {
      await start();

      workbench.fileBrowserFt.uploadInto('group-root', [new File(['a'], 'a.txt')]);

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'));
      expect(request.request.url).toBe('/api/fs/upload?path=&overwrite=false');
      expect(workbench.activeGroupId()).toBe('group-root');
      request.flush(fsEnvelope(fsDetails('a.txt')));
      await settled();
      http.expectOne(listUrl(''));
    });

    it('ignores an empty drop', async () => {
      await start();

      workbench.fileBrowserFt.uploadInto('group-root', []);

      http.expectNone(() => true);
    });
  });

});
