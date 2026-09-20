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
    expect(workbench.editorGroupsFt.grid).toBe(workbench.mockWorkbench.layout.grid);
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
});
