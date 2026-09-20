import { TestBed } from '@angular/core/testing';
import type { UiFileRow } from '@tr-file/ui';
import { WorkbenchService } from '../workbench.service';

describe('EditorGroupsFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    workbench = TestBed.inject(WorkbenchService);
  });

  const rowOf = (groupId: string, entryId: string): UiFileRow | undefined =>
    workbench.editorGroupsFt.group(groupId)?.rows.find((row) => row.id === entryId);

  it('exposes one view model per group, keyed by id', () => {
    expect(Object.keys(workbench.editorGroupsFt.groupsById())).toEqual(['group-prj', 'group-docs', 'group-assets']);
    expect(workbench.editorGroupsFt.group('nope')).toBeUndefined();
    expect(workbench.panelLayoutFt.grid()).toBe(workbench.mockWorkbench.layout.grid);
  });

  it('lists the group\'s directory with the configured columns', () => {
    const group = workbench.editorGroupsFt.group('group-docs');

    expect(group?.columns.map((column) => column.key)).toEqual(['name', 'size', 'modified']);
    expect(group?.columns[0]).toMatchObject({ label: 'Name', sort: 'asc' });
    expect(group?.rows.map((row) => row.id)).toEqual(workbench.mockFileSystem.list('docs/ai').map((entry) => entry.id));
    expect(rowOf('group-docs', 'docs/ai/EXPRESS.md')?.cells).toMatchObject({ size: '184 B', type: 'MD' });
  });

  describe('setView', () => {
    it('switches only the targeted group', () => {
      expect(workbench.editorGroupsFt.group('group-prj')?.view).toBe('list');
      expect(workbench.editorGroupsFt.group('group-docs')?.view).toBe('list');

      workbench.editorGroupsFt.setView('group-docs', 'grid');

      expect(workbench.editorGroupsFt.group('group-docs')?.view).toBe('grid');
      expect(workbench.editorGroupsFt.group('group-prj')?.view).toBe('list');
      expect(workbench.editorGroupsFt.group('group-assets')?.view).toBe('grid');
    });

    it('adds the item-count summary the grid view shows', () => {
      expect(workbench.editorGroupsFt.group('group-docs')?.summary).toBeUndefined();

      workbench.editorGroupsFt.setView('group-docs', 'grid');

      expect(workbench.editorGroupsFt.group('group-docs')?.summary).toBe('5 items');
    });
  });

  it('focus() moves the workbench-wide active group', () => {
    expect(workbench.editorGroupsFt.isActive('group-prj')).toBe(true);

    workbench.editorGroupsFt.focus('group-assets');

    expect(workbench.activeGroupId()).toBe('group-assets');
    expect(workbench.editorGroupsFt.isActive('group-assets')).toBe(true);
    expect(workbench.editorGroupsFt.isActive('group-prj')).toBe(false);
  });

  it('selectEntry() updates the group selection and the shared selection', () => {
    workbench.editorGroupsFt.selectEntry('group-docs', 'docs/ai/EXPRESS.md');

    expect(workbench.selectedEntryId()).toBe('docs/ai/EXPRESS.md');
    expect(workbench.activeGroupId()).toBe('group-docs');
    expect(rowOf('group-docs', 'docs/ai/EXPRESS.md')).toMatchObject({ selected: true, focused: true });
    // Single selection replaces whatever the group had selected before.
    expect(rowOf('group-docs', 'docs/ai/VSCODE-UI.md')?.selected).toBeUndefined();
    expect(workbench.editorGroupsFt.group('group-docs')?.items.filter((item) => item.selected).map((item) => item.id)).toEqual([
      'docs/ai/EXPRESS.md',
    ]);
  });

  describe('selection rendering', () => {
    it('renders the active group\'s selection as selected and focused', () => {
      expect(rowOf('group-prj', 'prj/frontend')).toMatchObject({ selected: true, focused: true });
      expect(rowOf('group-prj', 'prj/libs')).toMatchObject({ selected: true });
      expect(rowOf('group-prj', 'prj/libs')?.focused).toBeUndefined();
      expect(rowOf('group-prj', 'prj/libs')?.inactiveSelected).toBeUndefined();
    });

    it('dims the selection of a group that is not active', () => {
      const row = rowOf('group-docs', 'docs/ai/VSCODE-UI.md');

      expect(row?.inactiveSelected).toBe(true);
      expect(row?.selected).toBeUndefined();
      expect(row?.focused).toBeUndefined();
    });

    it('flips between the two as the active group changes', () => {
      workbench.editorGroupsFt.focus('group-docs');

      expect(rowOf('group-docs', 'docs/ai/VSCODE-UI.md')).toMatchObject({ selected: true });
      expect(rowOf('group-docs', 'docs/ai/VSCODE-UI.md')?.inactiveSelected).toBeUndefined();
      expect(rowOf('group-prj', 'prj/frontend')).toMatchObject({ inactiveSelected: true });
      expect(rowOf('group-prj', 'prj/frontend')?.selected).toBeUndefined();
      expect(rowOf('group-prj', 'prj/frontend')?.focused).toBeUndefined();
    });
  });

  it('builds breadcrumbs from the workspace path and the group path', () => {
    expect(workbench.editorGroupsFt.group('group-docs')?.breadcrumbs.map((crumb) => crumb.label)).toEqual([
      'local',
      'data',
      'src',
      'tr-file',
      'docs',
      'ai',
    ]);
  });

  it('derives tab icons from the tab path, or from the explicit override', () => {
    const tabs = workbench.editorGroupsFt.group('group-prj')?.tabs ?? [];

    expect(tabs.find((tab) => tab.id === 'tab-prj')).toMatchObject({ icon: 'folder', tint: 'folder', active: true });
    expect(tabs.find((tab) => tab.id === 'tab-search')).toMatchObject({ icon: 'search', tint: 'generic', preview: true });
  });

  /* -- panel interactivity (PRD 001 §6.1) --------------------------------- */

  const tabIds = (groupId: string): readonly string[] =>
    workbench.editorGroupsFt.group(groupId)?.tabs.map((tab) => tab.id) ?? [];

  const activeTabId = (groupId: string): string | undefined =>
    workbench.editorGroupsFt.group(groupId)?.tabs.find((tab) => tab.active)?.id;

  describe('selectTab', () => {
    it('moves the active flag and re-points the group at the tab\'s folder', () => {
      workbench.editorGroupsFt.selectTab('group-prj', 'tab-frontend');

      expect(activeTabId('group-prj')).toBe('tab-frontend');
      expect(workbench.editorGroupsFt.group('group-prj')?.rows.map((row) => row.id)).toEqual(
        workbench.mockFileSystem.list('prj/frontend').map((entry) => entry.id),
      );
      expect(workbench.editorGroupsFt.group('group-prj')?.breadcrumbs.at(-1)?.label).toBe('frontend');
    });

    it('gives the group focus', () => {
      workbench.editorGroupsFt.selectTab('group-docs', 'tab-prd-001');

      expect(workbench.activeGroupId()).toBe('group-docs');
      expect(activeTabId('group-docs')).toBe('tab-prd-001');
    });
  });

  describe('closeTab', () => {
    it('keeps a group that still has tabs, activating the first survivor', () => {
      workbench.editorGroupsFt.closeTab('group-prj', 'tab-prj');

      expect(tabIds('group-prj')).toEqual(['tab-frontend', 'tab-search']);
      expect(activeTabId('group-prj')).toBe('tab-frontend');
      expect(workbench.panelLayoutFt.groupIds()).toContain('group-prj');
    });

    it('takes the group out of the layout with its last tab and moves the active group', () => {
      workbench.editorGroupsFt.focus('group-assets');

      workbench.editorGroupsFt.closeTab('group-assets', 'tab-assets');

      expect(Object.keys(workbench.editorGroupsFt.groupsById())).toEqual(['group-prj', 'group-docs']);
      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-prj', 'group-docs']);
      expect(workbench.activeGroupId()).toBe('group-prj');
    });

    it('leaves one empty group behind when the very last tab closes', () => {
      workbench.editorGroupsFt.closeTab('group-assets', 'tab-assets');
      workbench.editorGroupsFt.closeTab('group-docs', 'tab-ai');
      workbench.editorGroupsFt.closeTab('group-docs', 'tab-prd-001');
      workbench.editorGroupsFt.closeTab('group-prj', 'tab-prj');
      workbench.editorGroupsFt.closeTab('group-prj', 'tab-frontend');
      workbench.editorGroupsFt.closeTab('group-prj', 'tab-search');

      const ids = Object.keys(workbench.editorGroupsFt.groupsById());
      const group = workbench.editorGroupsFt.group(ids[0] as string);

      expect(ids).toHaveLength(1);
      expect(workbench.activeGroupId()).toBe(ids[0]);
      expect(workbench.panelLayoutFt.grid()).toEqual({ kind: 'leaf', groupId: ids[0], size: 1 });
      expect(group?.empty).toMatchObject({ icon: 'folder-open', title: 'Open a folder to browse it here' });
      expect(group?.tabs).toEqual([]);
      expect(group?.actions).toEqual([]);
      expect(group?.breadcrumbs).toEqual([]);
      expect(group?.toolbarActions).toEqual([]);
      expect(group?.rows).toEqual([]);
    });
  });

  describe('moveTab', () => {
    it('moves a tab one slot along its own bar', () => {
      workbench.editorGroupsFt.moveTab('group-prj', { tabId: 'tab-prj', direction: 1 });

      expect(tabIds('group-prj')).toEqual(['tab-frontend', 'tab-prj', 'tab-search']);
    });

    it('clamps at both ends of the bar', () => {
      workbench.editorGroupsFt.moveTab('group-prj', { tabId: 'tab-prj', direction: -1 });

      expect(tabIds('group-prj')).toEqual(['tab-prj', 'tab-frontend', 'tab-search']);

      workbench.editorGroupsFt.moveTab('group-prj', { tabId: 'tab-search', direction: 1 });

      expect(tabIds('group-prj')).toEqual(['tab-prj', 'tab-frontend', 'tab-search']);
    });
  });

  describe('applyReorder', () => {
    it('reorders within one bar and activates the dropped tab', () => {
      workbench.editorGroupsFt.applyReorder({
        tabId: 'tab-search',
        groupId: 'group-prj',
        targetGroupId: 'group-prj',
        beforeTabId: 'tab-prj',
      });

      expect(tabIds('group-prj')).toEqual(['tab-search', 'tab-prj', 'tab-frontend']);
      expect(activeTabId('group-prj')).toBe('tab-search');
      expect(workbench.activeGroupId()).toBe('group-prj');
    });

    it('moves a tab across groups, pruning the source once it empties', () => {
      workbench.editorGroupsFt.applyReorder({
        tabId: 'tab-assets',
        groupId: 'group-assets',
        targetGroupId: 'group-prj',
        beforeTabId: 'tab-frontend',
      });

      expect(tabIds('group-prj')).toEqual(['tab-prj', 'tab-assets', 'tab-frontend', 'tab-search']);
      expect(activeTabId('group-prj')).toBe('tab-assets');
      expect(workbench.activeGroupId()).toBe('group-prj');
      expect(workbench.editorGroupsFt.group('group-assets')).toBeUndefined();
      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-prj', 'group-docs']);
    });
  });

  describe('applyZoneDrop', () => {
    it('joins the target group when the tab lands in the centre', () => {
      workbench.editorGroupsFt.applyZoneDrop({
        tabId: 'tab-assets',
        groupId: 'group-assets',
        targetGroupId: 'group-docs',
        zone: 'center',
      });

      expect(tabIds('group-docs')).toEqual(['tab-ai', 'tab-prd-001', 'tab-assets']);
      expect(activeTabId('group-docs')).toBe('tab-assets');
      expect(workbench.activeGroupId()).toBe('group-docs');
      expect(workbench.panelLayoutFt.groupIds()).toEqual(['group-prj', 'group-docs']);
    });

    it('divides the target group when the tab lands on an edge', () => {
      workbench.editorGroupsFt.applyZoneDrop({
        tabId: 'tab-frontend',
        groupId: 'group-prj',
        targetGroupId: 'group-docs',
        zone: 'bottom',
      });

      const ids = workbench.panelLayoutFt.groupIds();
      const newGroupId = ids[2] as string;

      expect(ids).toEqual(['group-prj', 'group-docs', newGroupId, 'group-assets']);
      expect(workbench.activeGroupId()).toBe(newGroupId);
      expect(tabIds(newGroupId)).toEqual(['tab-frontend']);
      expect(tabIds('group-prj')).toEqual(['tab-prj', 'tab-search']);
    });
  });

  describe('runAction', () => {
    it('split-right copies the active tab into a new group beside this one', () => {
      workbench.editorGroupsFt.runAction('group-prj', 'split-right');

      const ids = workbench.panelLayoutFt.groupIds();
      const newGroupId = ids[1] as string;

      expect(ids).toEqual(['group-prj', newGroupId, 'group-docs', 'group-assets']);
      expect(workbench.activeGroupId()).toBe(newGroupId);
      expect(tabIds(newGroupId)).toEqual([`tab-prj-${newGroupId}`]);
      expect(workbench.editorGroupsFt.group(newGroupId)?.tabs[0]).toMatchObject({ label: 'prj', active: true });
      // The original is left exactly as it was — splitting takes nothing away.
      expect(tabIds('group-prj')).toEqual(['tab-prj', 'tab-frontend', 'tab-search']);
      expect(activeTabId('group-prj')).toBe('tab-prj');
    });

    it('maximize toggles the layout\'s maximized group and relabels the action', () => {
      workbench.editorGroupsFt.runAction('group-docs', 'maximize');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBe('group-docs');
      expect(workbench.editorGroupsFt.group('group-docs')?.actions.find((action) => action.id === 'maximize')).toMatchObject({
        label: 'Restore group',
        active: true,
      });

      workbench.editorGroupsFt.runAction('group-docs', 'maximize');

      expect(workbench.panelLayoutFt.maximizedGroupId()).toBeNull();
      expect(workbench.editorGroupsFt.group('group-docs')?.actions.find((action) => action.id === 'maximize')).toMatchObject({
        label: 'Maximize group',
        active: false,
      });
    });
  });
});
