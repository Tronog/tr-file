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
    it('offers the three toolbar actions of an open group', async () => {
      await start();

      expect(workbench.fileBrowserFt.browser('group-root')?.toolbarActions.map((action) => action.id)).toEqual([
        'up',
        'refresh',
        'upload',
      ]);
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

  describe('setView()', () => {
    it('switches only the targeted group', async () => {
      await start();
      workbench.editorGroupsFt.runAction('group-root', 'split-right');
      const second = workbench.panelLayoutFt.groupIds()[1] as string;

      workbench.fileBrowserFt.setView('group-root', 'grid');

      expect(workbench.fileBrowserFt.browser('group-root')?.view).toBe('grid');
      expect(workbench.fileBrowserFt.browser(second)?.view).toBe('list');
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
