import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiTreeNode } from '@tr-file/ui';
import {
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsErrorBody,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/** What `/api/fs/list?path=` answers with in these tests. */
const ROOT_ENTRIES = [
  fsDirectory('docs'),
  fsDirectory('prj'),
  fsDirectory('.cache'),
  fsEntry('README.md', { size: 3482 }),
  fsEntry('.gitignore', { size: 120 }),
];

const DOCS_ENTRIES = [fsDirectory('docs/prd'), fsEntry('docs/NOTES.md', { size: 2048 })];

describe('ExplorerFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const ids = (): readonly string[] => workbench.explorerFt.nodes().map((node) => node.id);
  const row = (id: string): UiTreeNode | undefined =>
    workbench.explorerFt.nodes().find((node) => node.id === id);

  /** Starts the explorer only (the editor groups would list the root too). */
  const startExplorer = async (entries = ROOT_ENTRIES): Promise<void> => {
    workbench.explorerFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', entries)));
    await settled();
  };

  it('names the pane after the workspace and exposes the header actions', () => {
    expect(workbench.explorerFt.title).toBe(workbench.mockWorkbench.workspaceName);
    expect(workbench.explorerFt.actions).toBe(workbench.mockWorkbench.explorerActions);
  });

  describe('start()', () => {
    it('loads the root and renders its entries', async () => {
      expect(workbench.explorerFt.nodes()).toEqual([]);

      workbench.explorerFt.start();

      expect(workbench.explorerFt.loading()).toBe(true);
      http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
      await settled();

      expect(workbench.explorerFt.loading()).toBe(false);
      // Files are the panels' business: the tree carries directories only.
      expect(ids()).toEqual(['docs', 'prj']);
    });

    it('asks for the root once, however often it is called', async () => {
      await startExplorer();

      workbench.explorerFt.start();

      http.expectNone(listUrl(''));
    });

    it('surfaces a failed root listing as the pane message', async () => {
      workbench.explorerFt.start();
      http
        .expectOne(listUrl(''))
        .flush(fsErrorBody('FORBIDDEN', 'Outside the root'), { status: 403, statusText: 'Forbidden' });
      await settled();

      expect(workbench.explorerFt.error()).toBe('Outside the root');
      expect(workbench.explorerFt.nodes()).toEqual([]);
    });
  });

  describe('toggle()', () => {
    it('fetches a directory the first time it is expanded', async () => {
      await startExplorer();

      workbench.explorerFt.toggle('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(row('docs')?.expanded).toBe(true);
      expect(ids()).toEqual(['docs', 'docs/prd', 'prj']);
    });

    it('collapses on the second toggle without fetching again', async () => {
      await startExplorer();
      workbench.explorerFt.toggle('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      workbench.explorerFt.toggle('docs');

      expect(row('docs')?.expanded).toBe(false);
      expect(ids()).toEqual(['docs', 'prj']);

      // Re-expanding is served from the cache.
      workbench.explorerFt.toggle('docs');

      http.expectNone(listUrl('docs'));
      expect(ids()).toContain('docs/prd');
    });

    it('marks the row busy while its children are loading', async () => {
      await startExplorer();

      workbench.explorerFt.toggle('docs');

      expect(row('docs')?.busy).toBe(true);

      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(row('docs')?.busy).toBeUndefined();
      expect(row('prj')?.busy).toBeUndefined();
    });

    it('marks a directory that would not open as unreadable', async () => {
      await startExplorer();

      workbench.explorerFt.toggle('prj');
      http
        .expectOne(listUrl('prj'))
        .flush(fsErrorBody('FORBIDDEN', 'Permission denied'), { status: 403, statusText: 'Forbidden' });
      await settled();

      expect(row('prj')?.meta).toBe('unreadable');
      expect(row('prj')?.busy).toBeUndefined();
    });
  });

  describe('flattened rows', () => {
    beforeEach(async () => {
      await startExplorer();
      workbench.explorerFt.toggle('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();
    });

    it('contains only the children of expanded directories', () => {
      expect(ids()).toEqual(['docs', 'docs/prd', 'prj']);
      // `docs/prd` and `prj` are collapsed, so neither was listed at all.
      http.expectNone(listUrl('docs/prd'));
      http.expectNone(listUrl('prj'));
    });

    it('carries the depth and one indent guide per ancestor level', () => {
      expect(row('docs')).toMatchObject({ depth: 0, guides: [] });
      expect(row('docs/prd')).toMatchObject({ depth: 1, guides: [true] });
    });

    it('describes every row as an expandable directory', () => {
      expect(row('docs')).toMatchObject({ expandable: true, expanded: true, icon: 'folder-open', tint: 'folder' });
      expect(row('docs/prd')).toMatchObject({ expandable: true, expanded: false, icon: 'folder' });
      // Directories carry no size hint of their own.
      expect(row('docs')?.meta).toBeUndefined();
    });

    it('leaves files out of the tree, shown or hidden', () => {
      expect(ids()).not.toContain('README.md');
      expect(ids()).not.toContain('docs/NOTES.md');

      workbench.showHidden.set(true);

      expect(ids()).not.toContain('.gitignore');
    });

    it('decorates hidden directories as ignored once they are shown', () => {
      expect(ids()).not.toContain('.cache');

      workbench.showHidden.set(true);

      expect(ids()).toContain('.cache');
      expect(row('.cache')?.decoration).toBe('ignored');
      expect(row('docs')?.decoration).toBeUndefined();
    });
  });

  describe('expand()', () => {
    it('opens a directory and lists it', async () => {
      await startExplorer();

      workbench.explorerFt.expand('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(row('docs')?.expanded).toBe(true);
      expect(ids()).toContain('docs/prd');
    });

    it('leaves an already open directory open, and asks for nothing', async () => {
      await startExplorer();
      workbench.explorerFt.expand('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      // Row clicks open but never close: that is the twisty's job.
      workbench.explorerFt.expand('docs');
      await settled();

      expect(workbench.explorerFt.isExpanded('docs')).toBe(true);
      expect(row('docs')?.expanded).toBe(true);
    });
  });

  describe('runAction()', () => {
    it('refresh re-reads every expanded directory', async () => {
      await startExplorer();
      workbench.explorerFt.toggle('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      workbench.explorerFt.runAction('refresh');

      expect(http.match(listUrl(''))).toHaveLength(1);
      expect(http.match(listUrl('docs'))).toHaveLength(1);
      await settled();
    });

    it('collapse closes everything but the root', async () => {
      await startExplorer();
      workbench.explorerFt.toggle('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      workbench.explorerFt.runAction('collapse');

      expect(ids()).toEqual(['docs', 'prj']);
      expect(row('docs')?.expanded).toBe(false);
    });

    it('ignores an action it does not know', async () => {
      await startExplorer();

      workbench.explorerFt.runAction('new-file');

      http.expectNone(() => true);
      expect(ids()).toEqual(['docs', 'prj']);
    });
  });
});
