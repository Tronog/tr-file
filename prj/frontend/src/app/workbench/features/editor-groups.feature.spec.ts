import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiFileRow } from '@tr-file/file-ui';
import {
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { provideOnePanel } from '../testing/one-panel';

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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel()],
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

      expect(workbench.editorGroupsFt.group('group-root')?.loading).toBeUndefined();
      const browser = workbench.fileBrowserFt.browser('group-root');
      expect(browser?.rows.map((row) => row.id)).toEqual(['docs', 'main.ts', 'README.md']);
      // The grid's items are built only while the grid shows (PRD 004, §3.1).
      expect(browser?.items).toEqual([]);
      workbench.fileBrowserFt.setView('group-root', 'grid');
      expect(workbench.fileBrowserFt.browser('group-root')?.items.map((item) => item.id)).toEqual(['docs', 'main.ts', 'README.md']);
      workbench.fileBrowserFt.setView('group-root', 'list');
      expect(browser?.summary).toBe('3 items');
      expect(browser?.columns.map((column) => column.key)).toEqual(['name', 'size', 'type', 'modified']);
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
      expect(group?.actions).toEqual([]);
      // No tab, so no content: nothing to browse, and nothing to render it with.
      expect(workbench.editorGroupsFt.activeContent(id)).toBeNull();
      expect(workbench.fileBrowserFt.browser(id)).toBeUndefined();
      expect(workbench.editorGroupsFt.acceptsFiles(id)).toBe(false);
    });
  });

  describe('panel content', () => {
    it('shows a folder tab as file management, which takes dropped files', async () => {
      await start();

      expect(workbench.editorGroupsFt.activeContent('group-root')).toBe('files');
      expect(workbench.editorGroupsFt.acceptsFiles('group-root')).toBe(true);
      expect(workbench.fileBrowserFt.browser('group-root')).toBeDefined();
    });

    it('frames only the tabs and the loading rail, leaving the body to the content', async () => {
      await start();

      expect(workbench.editorGroupsFt.group('group-root')).toEqual({
        id: 'group-root',
        tabs: [expect.objectContaining({ id: 'tab-root', active: true })],
        actions: [
          expect.objectContaining({ id: 'split-right' }),
          expect.objectContaining({ id: 'split-down' }),
          expect.objectContaining({ id: 'maximize' }),
        ],
      });
    });

    it('knows nothing about a group that does not exist', () => {
      expect(workbench.editorGroupsFt.activeContent('nope')).toBeNull();
      expect(workbench.editorGroupsFt.acceptsFiles('nope')).toBe(false);
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
      expect(workbench.fileBrowserFt.browser(newGroupId)?.rows.map((row) => row.id)).toEqual([
        'docs',
        'main.ts',
        'README.md',
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
      workbench.fileBrowserFt.openEntry('group-root', 'docs');
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

  /** PRD 001, Fix 4 — each tab of a panel keeps its own selection while another is chosen. */
  describe('selection per tab', () => {
    const group = 'group-root';
    const state = () => workbench.editorGroupsFt.stateOf(group);
    const select = (paths: string[], focused = paths[0]) =>
      workbench.editorGroupsFt.update(group, (current) => ({ ...current, selection: paths, ...(focused === undefined ? {} : { focusedEntryId: focused }) }));

    beforeEach(async () => {
      await start();
      vi.spyOn(workbench.detailsFt, 'load').mockImplementation(() => undefined);
      workbench.editorGroupsFt.setTabs(
        group,
        [
          { id: 'root', label: 'tr-file', path: '', kind: 'folder' },
          { id: 'docs', label: 'docs', path: 'docs', kind: 'folder' },
        ],
        'root',
      );
    });

    const toDocs = async () => {
      workbench.editorGroupsFt.selectTab(group, 'docs');
      for (const request of http.match(listUrl('docs'))) {
        request.flush(fsEnvelope(fsListing('docs', [fsEntry('docs/NOTES.md'), fsEntry('docs/TODO.md')])));
      }
      await settled();
    };

    it('gives a tab back what was selected in it, and where the cursor was', async () => {
      select(['README.md', 'main.ts'], 'main.ts');

      await toDocs();
      expect(state()?.selection).toEqual([]);
      select(['docs/TODO.md']);

      workbench.editorGroupsFt.selectTab(group, 'root');
      expect(state()?.selection).toEqual(['README.md', 'main.ts']);
      expect(state()?.focusedEntryId).toBe('main.ts');

      await toDocs();
      expect(state()?.selection).toEqual(['docs/TODO.md']);
      expect(state()?.focusedEntryId).toBe('docs/TODO.md');
    });

    it('points the details sidebar at the cursor it gives back', async () => {
      select(['main.ts']);
      await toDocs();
      const follow = vi.spyOn(workbench, 'select');

      workbench.editorGroupsFt.selectTab(group, 'root');

      expect(follow).toHaveBeenCalledWith('main.ts');
    });

    it('gives the tab that is left showing its selection when the active one closes', async () => {
      select(['README.md']);
      await toDocs();
      select(['docs/NOTES.md']);

      workbench.editorGroupsFt.closeTab(group, 'docs');

      expect(state()?.path).toBe('');
      expect(state()?.selection).toEqual(['README.md']);
    });

    it('does not keep what it remembers beyond the session', async () => {
      select(['README.md']);
      await toDocs();
      expect(state()?.tabs.find((tab) => tab.id === 'root')?.remembered).toEqual({ path: '', selection: ['README.md'], focusedEntryId: 'README.md' });

      const write = vi.spyOn(workbench.settings, 'set');
      workbench.sessionFt.start();
      workbench.editorGroupsFt.setTabs(group, state()?.tabs ?? [], 'docs');
      TestBed.tick();
      workbench.sessionFt.flush();

      const saved = write.mock.calls.filter(([key]) => key.startsWith('tr-file.session.v1'));
      expect(saved.length).toBeGreaterThan(0);
      expect(JSON.stringify(saved)).not.toContain('remembered');
    });
  });
});

