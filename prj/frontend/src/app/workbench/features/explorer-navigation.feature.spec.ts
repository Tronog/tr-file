import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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

const ROOT_ENTRIES = [fsDirectory('docs'), fsDirectory('prj'), fsEntry('README.md', { size: 27 })];
const DOCS_ENTRIES = [fsDirectory('docs/prd'), fsEntry('docs/NOTES.md', { size: 2048 })];

describe('ExplorerNavigationFeature', () => {
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

  /** Brings the workbench up: the root listing serves both explorer and panel. */
  const start = async (): Promise<void> => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
    http.expectOne(detailsUrl('')).flush(fsEnvelope(fsDirectoryDetails('', { entryCount: 3 })));
    await settled();
  };

  const activeGroup = () => workbench.editorGroupsFt.group(workbench.activeGroupId());
  const crumbs = (): string =>
    (activeGroup()?.breadcrumbs ?? []).map((crumb) => crumb.label).join('/');
  const rows = (): readonly string[] => (activeGroup()?.rows ?? []).map((row) => row.id);
  const treeRow = (id: string) => workbench.explorerFt.nodes().find((node) => node.id === id);

  describe('clicking a folder', () => {
    it('selects it, reveals its children and shows it in the active panel', async () => {
      await start();

      workbench.explorerNavFt.open('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(workbench.selectedEntryId()).toBe('docs');
      expect(treeRow('docs')).toMatchObject({ selected: true, expanded: true });
      expect(workbench.explorerFt.nodes().map((node) => node.id)).toContain('docs/NOTES.md');
      expect(crumbs()).toBe('tr-file/docs');
      expect(rows()).toEqual(['docs/prd', 'docs/NOTES.md']);
      expect(activeGroup()?.tabs[0]).toMatchObject({ label: 'docs', active: true });
    });

    it('lists a directory once for both the tree and the panel', async () => {
      await start();

      workbench.explorerNavFt.open('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      // One request, not two: both readers share the cache.
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      http.expectNone(listUrl('docs'));
    });

    it('opens again rather than closing when it is already expanded', async () => {
      await start();
      workbench.explorerNavFt.open('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      // Navigate away, then click the same folder in the tree a second time.
      workbench.editorGroupsFt.navigateTo(workbench.activeGroupId(), '', 'tr-file');
      await settled();

      workbench.explorerNavFt.open('docs');
      await settled();

      expect(treeRow('docs')?.expanded).toBe(true);
      expect(crumbs()).toBe('tr-file/docs');
    });

    it('walks back to the workspace root', async () => {
      await start();
      workbench.explorerNavFt.open('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      workbench.explorerNavFt.open('');
      await settled();

      expect(crumbs()).toBe('tr-file');
      expect(activeGroup()?.tabs[0]).toMatchObject({ label: 'tr-file' });
    });
  });

  describe('clicking a file', () => {
    it('selects it and leaves the panel where it is', async () => {
      await start();

      workbench.explorerNavFt.open('README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await settled();

      expect(workbench.selectedEntryId()).toBe('README.md');
      expect(treeRow('README.md')).toMatchObject({ selected: true });
      // No listing was requested, and the panel still shows the root.
      expect(crumbs()).toBe('tr-file');
      expect(rows()).toEqual(['docs', 'prj', 'README.md']);
    });
  });

  describe('with more than one panel', () => {
    it('lands in the active group and leaves the other alone', async () => {
      await start();
      const first = workbench.activeGroupId();

      // Split: the copy becomes the active group.
      workbench.editorGroupsFt.runAction(first, 'split-right');
      const second = workbench.activeGroupId();
      expect(second).not.toBe(first);

      workbench.explorerNavFt.open('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      expect(workbench.editorGroupsFt.pathOf(second)).toBe('docs');
      expect(workbench.editorGroupsFt.pathOf(first)).toBe('');
    });

    it('follows the focus to whichever group is active', async () => {
      await start();
      const first = workbench.activeGroupId();
      workbench.editorGroupsFt.runAction(first, 'split-right');
      const second = workbench.activeGroupId();

      workbench.editorGroupsFt.focus(first);
      workbench.explorerNavFt.open('prj');
      http.expectOne(detailsUrl('prj')).flush(fsEnvelope(fsDirectoryDetails('prj')));
      http.expectOne(listUrl('prj')).flush(fsEnvelope(fsListing('prj', [])));
      await settled();

      expect(workbench.editorGroupsFt.pathOf(first)).toBe('prj');
      expect(workbench.editorGroupsFt.pathOf(second)).toBe('');
    });
  });

  describe('with an empty panel', () => {
    it('gives the group a tab instead of pointing a tabless panel somewhere', async () => {
      await start();
      const groupId = workbench.activeGroupId();
      const tabId = workbench.editorGroupsFt.group(groupId)?.tabs[0]?.id ?? '';

      workbench.editorGroupsFt.closeTab(groupId, tabId);
      const emptyGroupId = workbench.activeGroupId();
      expect(workbench.editorGroupsFt.group(emptyGroupId)?.tabs).toEqual([]);
      expect(workbench.editorGroupsFt.group(emptyGroupId)?.empty).toBeDefined();

      workbench.explorerNavFt.open('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', DOCS_ENTRIES)));
      await settled();

      const group = workbench.editorGroupsFt.group(workbench.activeGroupId());
      expect(group?.tabs).toHaveLength(1);
      expect(group?.tabs[0]).toMatchObject({ label: 'docs', active: true });
      expect(group?.empty).toBeUndefined();
      expect(group?.rows.map((row) => row.id)).toEqual(['docs/prd', 'docs/NOTES.md']);
    });
  });

  describe('an entry the cache has never seen', () => {
    it('is treated as a file: selected, with no navigation', async () => {
      await start();

      workbench.explorerNavFt.open('nowhere/at/all');
      http.expectOne(detailsUrl('nowhere/at/all')).flush(fsEnvelope(fsDetails('nowhere/at/all')));
      await settled();

      expect(workbench.selectedEntryId()).toBe('nowhere/at/all');
      expect(crumbs()).toBe('tr-file');
    });
  });
});
