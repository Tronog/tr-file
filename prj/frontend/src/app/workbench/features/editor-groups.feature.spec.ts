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

describe('EditorGroupsFeature', () => {
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
    workbench.editorGroupsFt.group(groupId)?.rows.find((row) => row.id === entryId);

  const tabIds = (groupId: string): readonly string[] =>
    workbench.editorGroupsFt.group(groupId)?.tabs.map((tab) => tab.id) ?? [];

  const activeTabId = (groupId: string): string | undefined =>
    workbench.editorGroupsFt.group(groupId)?.tabs.find((tab) => tab.active)?.id;

  /** Starts the editor area and answers the seeded group's listing. */
  const start = async (entries = ROOT_ENTRIES): Promise<void> => {
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', entries)));
    await settled();
  };

  it('starts with one group on the workspace root', () => {
    expect(Object.keys(workbench.editorGroupsFt.groupsById())).toEqual(['group-root']);
    expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
    expect(workbench.editorGroupsFt.group('nope')).toBeUndefined();
  });

  describe('start()', () => {
    it("loads the seeded group's directory and lists it", async () => {
      workbench.editorGroupsFt.start();

      expect(workbench.editorGroupsFt.group('group-root')?.loading).toBe(true);

      http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
      await settled();

      const group = workbench.editorGroupsFt.group('group-root');
      expect(group?.loading).toBeUndefined();
      expect(group?.rows.map((row) => row.id)).toEqual(['docs', 'README.md', 'main.ts']);
      expect(group?.items.map((item) => item.id)).toEqual(['docs', 'README.md', 'main.ts']);
      expect(group?.summary).toBe('3 items');
      expect(group?.columns.map((column) => column.key)).toEqual(['name', 'size', 'type', 'modified']);
      expect(rowOf('group-root', 'README.md')?.cells).toMatchObject({
        size: '3.4 KB',
        type: 'MD',
        modified: 'Sep 20, 13:04',
      });
    });

    it('asks for the directory once', async () => {
      await start();

      workbench.editorGroupsFt.start();

      http.expectNone(listUrl(''));
    });
  });

  describe('empty states', () => {
    it('invites a folder to be opened when the group holds no tabs', async () => {
      await start();

      workbench.editorGroupsFt.closeTab('group-root', 'tab-root');

      const id = Object.keys(workbench.editorGroupsFt.groupsById())[0] as string;
      const group = workbench.editorGroupsFt.group(id);
      expect(group?.empty).toMatchObject({ icon: 'folder-open', title: 'Open a folder to browse it here' });
      expect(group?.tabs).toEqual([]);
      expect(group?.toolbarActions).toEqual([]);
      expect(group?.breadcrumbs).toEqual([]);
      expect(group?.rows).toEqual([]);
      expect(group?.summary).toBeUndefined();
    });

    it('reports a folder that could not be read, with the server message', async () => {
      workbench.editorGroupsFt.start();
      http
        .expectOne(listUrl(''))
        .flush(fsErrorBody('FORBIDDEN', 'Outside the root'), { status: 403, statusText: 'Forbidden' });
      await settled();

      expect(workbench.editorGroupsFt.group('group-root')?.empty).toEqual({
        icon: 'alert-triangle',
        title: 'Could not open this folder',
        hint: 'Outside the root',
      });
    });

    it('offers to fill an empty folder', async () => {
      await start([]);

      expect(workbench.editorGroupsFt.group('group-root')?.empty).toMatchObject({
        title: 'This folder is empty',
        hint: 'Drop files here to upload them',
      });
      expect(workbench.editorGroupsFt.group('group-root')?.summary).toBe('0 items');
    });

    it('shows no placeholder while a folder with contents is open', async () => {
      await start();

      expect(workbench.editorGroupsFt.group('group-root')?.empty).toBeUndefined();
    });
  });

  describe('openEntry()', () => {
    it('navigates the group into a directory, moving tab, path and breadcrumbs', async () => {
      await start();

      workbench.editorGroupsFt.openEntry('group-root', 'docs');

      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsEntry('docs/NOTES.md')])));
      await settled();

      const group = workbench.editorGroupsFt.group('group-root');
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('docs');
      expect(group?.tabs[0]).toMatchObject({ id: 'tab-root', label: 'docs', active: true });
      expect(group?.breadcrumbs.map((crumb) => crumb.label)).toEqual(['tr-file', 'docs']);
      expect(group?.rows.map((row) => row.id)).toEqual(['docs/NOTES.md']);
    });

    it('hands a file to the browser instead of navigating', async () => {
      await start();
      const hrefs: (string | null)[] = [];
      const create = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = create(tag);
        if (tag === 'a') {
          element.click = () => hrefs.push(element.getAttribute('href'));
        }
        return element;
      }) as typeof document.createElement);

      workbench.editorGroupsFt.openEntry('group-root', 'README.md');

      expect(hrefs).toEqual([downloadUrl('README.md')]);
      // Nothing was navigated: the group still lists the same directory, and
      // the download is a browser transfer, not an `HttpClient` request.
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
      expect(workbench.editorGroupsFt.group('group-root')?.tabs[0]?.label).toBe('tr-file');
      http.expectNone(() => true);
    });

    it('ignores an entry the listing does not contain', async () => {
      await start();

      workbench.editorGroupsFt.openEntry('group-root', 'nope');

      http.expectNone(() => true);
      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
    });
  });

  describe('runToolbarAction()', () => {
    it('offers the three toolbar actions of an open group', async () => {
      await start();

      expect(workbench.editorGroupsFt.group('group-root')?.toolbarActions.map((action) => action.id)).toEqual([
        'up',
        'refresh',
        'upload',
      ]);
    });

    it('up walks the group to the parent directory', async () => {
      await start();
      workbench.editorGroupsFt.openEntry('group-root', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsDirectory('docs/prd')])));
      await settled();
      workbench.editorGroupsFt.openEntry('group-root', 'docs/prd');
      http.expectOne(listUrl('docs/prd')).flush(fsEnvelope(fsListing('docs/prd')));
      await settled();

      workbench.editorGroupsFt.runToolbarAction('group-root', 'up');

      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('docs');
      expect(workbench.editorGroupsFt.group('group-root')?.tabs[0]?.label).toBe('docs');
      // `docs` is still cached, so walking back up costs no request.
      http.expectNone(listUrl('docs'));
    });

    it('up does nothing at the root', async () => {
      await start();

      workbench.editorGroupsFt.runToolbarAction('group-root', 'up');

      expect(workbench.editorGroupsFt.pathOf('group-root')).toBe('');
      http.expectNone(() => true);
    });

    it('refresh re-reads the open directory', async () => {
      await start();

      workbench.editorGroupsFt.runToolbarAction('group-root', 'refresh');

      http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsEntry('new.ts')])));
      await settled();

      expect(workbench.editorGroupsFt.group('group-root')?.rows.map((row) => row.id)).toEqual(['new.ts']);
    });

    it('upload asks the component for the file picker', async () => {
      await start();

      workbench.editorGroupsFt.runToolbarAction('group-root', 'upload');

      expect(workbench.uploadRequest()).toEqual({ groupId: 'group-root', path: '' });
    });

    it('ignores an unknown action and an unknown group', async () => {
      await start();

      workbench.editorGroupsFt.runToolbarAction('group-root', 'sort');
      workbench.editorGroupsFt.runToolbarAction('nope', 'refresh');

      http.expectNone(() => true);
      expect(workbench.uploadRequest()).toBeNull();
    });
  });

  describe('selectEntry()', () => {
    it('updates the group selection and the workbench selection', async () => {
      await start();

      workbench.editorGroupsFt.selectEntry('group-root', 'README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      await settled();

      expect(workbench.selectedEntryId()).toBe('README.md');
      expect(workbench.activeGroupId()).toBe('group-root');
      expect(rowOf('group-root', 'README.md')).toMatchObject({ selected: true, focused: true });
      expect(rowOf('group-root', 'main.ts')?.selected).toBeUndefined();
      expect(
        workbench.editorGroupsFt
          .group('group-root')
          ?.items.filter((item) => item.selected)
          .map((item) => item.id),
      ).toEqual(['README.md']);
    });

    it('replaces the previous selection rather than adding to it', async () => {
      await start();

      workbench.editorGroupsFt.selectEntry('group-root', 'README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      workbench.editorGroupsFt.selectEntry('group-root', 'main.ts');
      http.expectOne(detailsUrl('main.ts')).flush(fsEnvelope(fsDetails('main.ts')));
      await settled();

      expect(rowOf('group-root', 'README.md')?.selected).toBeUndefined();
      expect(rowOf('group-root', 'main.ts')?.selected).toBe(true);
    });

    it('dims the selection of a group that is not active', async () => {
      await start();
      workbench.editorGroupsFt.selectEntry('group-root', 'README.md');
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
      workbench.editorGroupsFt.openEntry('group-root', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs')));
      await settled();

      workbench.editorGroupsFt.openBreadcrumb('group-root', 'root');

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

      workbench.editorGroupsFt.setView('group-root', 'grid');

      expect(workbench.editorGroupsFt.group('group-root')?.view).toBe('grid');
      expect(workbench.editorGroupsFt.group(second)?.view).toBe('list');
    });
  });

  describe('uploadInto()', () => {
    it('starts one upload per dropped file in the group directory', async () => {
      await start();

      workbench.editorGroupsFt.uploadInto('group-root', [new File(['a'], 'a.txt')]);

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'));
      expect(request.request.url).toBe('/api/fs/upload?path=&overwrite=false');
      expect(workbench.activeGroupId()).toBe('group-root');
      request.flush(fsEnvelope(fsDetails('a.txt')));
      await settled();
      http.expectOne(listUrl(''));
    });

    it('ignores an empty drop', async () => {
      await start();

      workbench.editorGroupsFt.uploadInto('group-root', []);

      http.expectNone(() => true);
    });
  });

  /* -- panel interactivity (PRD 001 §6.1) --------------------------------- */

  describe('runAction()', () => {
    it('split-right copies the active tab into a new group beside this one', async () => {
      await start();

      workbench.editorGroupsFt.runAction('group-root', 'split-right');

      const ids = workbench.panelLayoutFt.groupIds();
      const newGroupId = ids[1] as string;

      expect(ids).toEqual(['group-root', newGroupId]);
      expect(workbench.activeGroupId()).toBe(newGroupId);
      expect(tabIds(newGroupId)).toEqual([`tab-root-${newGroupId}`]);
      expect(workbench.editorGroupsFt.group(newGroupId)?.tabs[0]).toMatchObject({ label: 'tr-file', active: true });
      // The original is left exactly as it was — splitting takes nothing away.
      expect(tabIds('group-root')).toEqual(['tab-root']);
      expect(activeTabId('group-root')).toBe('tab-root');
      // Both groups show the same cached directory, fetched once.
      expect(workbench.editorGroupsFt.group(newGroupId)?.rows.map((row) => row.id)).toEqual([
        'docs',
        'README.md',
        'main.ts',
      ]);
    });

    it('split-down divides the group along the other axis', async () => {
      await start();

      workbench.editorGroupsFt.runAction('group-root', 'split-down');

      const grid = workbench.panelLayoutFt.grid();
      expect(grid.kind === 'split' ? grid.direction : undefined).toBe('column');
      expect(workbench.panelLayoutFt.groupIds()).toHaveLength(2);
    });

    it("maximize toggles the layout's maximized group and relabels the action", async () => {
      await start();

      workbench.editorGroupsFt.runAction('group-root', 'maximize');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBe('group-root');
      expect(
        workbench.editorGroupsFt.group('group-root')?.actions.find((action) => action.id === 'maximize'),
      ).toMatchObject({ label: 'Restore group', active: true });

      workbench.editorGroupsFt.runAction('group-root', 'maximize');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
      expect(
        workbench.editorGroupsFt.group('group-root')?.actions.find((action) => action.id === 'maximize'),
      ).toMatchObject({ label: 'Maximize group', active: false });
    });
  });

  describe('tab operations across two groups', () => {
    let second: string;

    beforeEach(async () => {
      await start();
      // A split gives the workbench a second group to drag tabs between.
      workbench.editorGroupsFt.runAction('group-root', 'split-right');
      second = workbench.panelLayoutFt.groupIds()[1] as string;
    });

    it('selectTab re-points the group at the tab folder and focuses it', async () => {
      workbench.editorGroupsFt.openEntry('group-root', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsEntry('docs/NOTES.md')])));
      await settled();

      workbench.editorGroupsFt.selectTab(second, `tab-root-${second}`);

      expect(workbench.activeGroupId()).toBe(second);
      expect(activeTabId(second)).toBe(`tab-root-${second}`);
      expect(workbench.editorGroupsFt.pathOf(second)).toBe('');
      http.expectNone(listUrl(''));
    });

    it('moveTab clamps at both ends of a bar', () => {
      workbench.editorGroupsFt.moveTab('group-root', { tabId: 'tab-root', direction: 1 });
      expect(tabIds('group-root')).toEqual(['tab-root']);

      workbench.editorGroupsFt.moveTab('group-root', { tabId: 'tab-root', direction: -1 });
      expect(tabIds('group-root')).toEqual(['tab-root']);
    });

    it('applyReorder moves a tab across groups, pruning the source once it empties', () => {
      workbench.editorGroupsFt.applyReorder({
        tabId: 'tab-root',
        groupId: 'group-root',
        targetGroupId: second,
        beforeTabId: `tab-root-${second}`,
      });

      expect(tabIds(second)).toEqual(['tab-root', `tab-root-${second}`]);
      expect(activeTabId(second)).toBe('tab-root');
      expect(workbench.activeGroupId()).toBe(second);
      expect(workbench.editorGroupsFt.group('group-root')).toBeUndefined();
      expect(workbench.panelLayoutFt.groupIds()).toEqual([second]);
    });

    it('applyReorder within one bar activates the dropped tab', () => {
      workbench.editorGroupsFt.applyReorder({
        tabId: `tab-root-${second}`,
        groupId: second,
        targetGroupId: second,
        beforeTabId: null,
      });

      expect(tabIds(second)).toEqual([`tab-root-${second}`]);
      expect(activeTabId(second)).toBe(`tab-root-${second}`);
      expect(workbench.activeGroupId()).toBe(second);
    });

    it('a centre zone drop joins the target group', () => {
      workbench.editorGroupsFt.applyZoneDrop({
        tabId: 'tab-root',
        groupId: 'group-root',
        targetGroupId: second,
        zone: 'center',
      });

      expect(tabIds(second)).toEqual([`tab-root-${second}`, 'tab-root']);
      expect(activeTabId(second)).toBe('tab-root');
      expect(workbench.panelLayoutFt.groupIds()).toEqual([second]);
    });

    it('an edge zone drop divides the target group and gives it the tab', () => {
      workbench.editorGroupsFt.applyZoneDrop({
        tabId: 'tab-root',
        groupId: 'group-root',
        targetGroupId: second,
        zone: 'bottom',
      });

      const ids = workbench.panelLayoutFt.groupIds();
      const third = ids.find((id) => id !== second) as string;

      expect(ids).toEqual([second, third]);
      expect(tabIds(third)).toEqual(['tab-root']);
      expect(workbench.activeGroupId()).toBe(third);
      // `group-root` gave away its only tab, so it left the layout.
      expect(workbench.editorGroupsFt.group('group-root')).toBeUndefined();
    });

    it('refuses to divide a group with its own only tab', () => {
      workbench.editorGroupsFt.applyZoneDrop({
        tabId: 'tab-root',
        groupId: 'group-root',
        targetGroupId: 'group-root',
        zone: 'right',
      });

      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-root', second]);
    });

    it('closeTab keeps the layout when another group survives', () => {
      workbench.editorGroupsFt.closeTab('group-root', 'tab-root');

      expect(Object.keys(workbench.editorGroupsFt.groupsById())).toEqual([second]);
      expect(workbench.panelLayoutFt.groupIds()).toEqual([second]);
      expect(workbench.activeGroupId()).toBe(second);
    });

    it('leaves one empty group behind when the very last tab closes', () => {
      workbench.editorGroupsFt.closeTab('group-root', 'tab-root');
      workbench.editorGroupsFt.closeTab(second, `tab-root-${second}`);

      const ids = Object.keys(workbench.editorGroupsFt.groupsById());

      expect(ids).toHaveLength(1);
      expect(workbench.activeGroupId()).toBe(ids[0]);
      expect(workbench.panelLayoutFt.grid()).toEqual({ kind: 'leaf', groupId: ids[0], size: 1 });
      expect(workbench.editorGroupsFt.group(ids[0] as string)?.empty).toMatchObject({
        title: 'Open a folder to browse it here',
      });
    });
  });
});
