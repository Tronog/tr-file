import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

describe('ExplorerFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    workbench = TestBed.inject(WorkbenchService);
  });

  const ids = () => workbench.explorerFt.nodes().map((node) => node.id);
  const row = (id: string) => workbench.explorerFt.nodes().find((node) => node.id === id);

  it('names the pane after the workspace and exposes the header actions', () => {
    expect(workbench.explorerFt.title).toBe(workbench.mockFileSystem.workspaceName);
    expect(workbench.explorerFt.actions).toBe(workbench.mockWorkbench.explorerActions);
  });

  it('flattens only the children of expanded directories', () => {
    const expanded = new Set(workbench.mockWorkbench.layout.expandedPaths);
    expect(expanded.has('prj/frontend')).toBe(true);
    expect(expanded.has('prj/backend')).toBe(false);

    // `prj` is expanded, so its children are rows…
    expect(ids()).toContain('prj/frontend');
    // …and `prj/frontend` is expanded too, so its children are rows…
    expect(ids()).toContain('prj/frontend/package.json');
    // …while the collapsed `prj/backend` contributes no children.
    expect(ids()).toContain('prj/backend');
    expect(ids()).not.toContain('prj/backend/src');
  });

  it('keeps rows in depth-first order with the depth of their level', () => {
    const rendered = ids();
    expect(rendered[0]).toBe('prj');
    expect(rendered.indexOf('prj/frontend/package.json')).toBeGreaterThan(rendered.indexOf('prj/frontend'));
    expect(rendered.indexOf('docs')).toBeGreaterThan(rendered.indexOf('prj/frontend/package.json'));

    expect(row('prj')?.depth).toBe(0);
    expect(row('prj/frontend')?.depth).toBe(1);
    expect(row('prj/frontend/package.json')?.depth).toBe(2);
  });

  it('draws one indent guide per ancestor level', () => {
    expect(row('prj')?.guides).toEqual([]);
    expect(row('prj/frontend')?.guides).toEqual([true]);
    expect(row('prj/frontend/package.json')?.guides).toEqual([true, true]);
  });

  it('marks expandable rows and carries the view-model decoration through', () => {
    expect(row('prj')).toMatchObject({ expandable: true, expanded: true, icon: 'folder-open', tint: 'folder' });
    expect(row('prj/backend')).toMatchObject({ expandable: true, expanded: false, icon: 'folder', meta: '12 items' });
    expect(row('prj/frontend/package.json')).toMatchObject({ expandable: false, icon: 'file', tint: 'json', meta: 'M' });
    expect(row('prj/frontend/package.json')?.expanded).toBeUndefined();
  });

  it('expands a collapsed directory and collapses it again', () => {
    workbench.explorerFt.toggle('prj/backend');
    expect(row('prj/backend')?.expanded).toBe(true);
    expect(ids()).toContain('prj/backend/src');
    expect(row('prj/backend')?.meta).toBeUndefined();

    workbench.explorerFt.toggle('prj/backend');
    expect(row('prj/backend')?.expanded).toBe(false);
    expect(ids()).not.toContain('prj/backend/src');
  });

  it('drops the whole subtree when an ancestor collapses', () => {
    workbench.explorerFt.toggle('prj');
    expect(ids()).toEqual(['prj', 'docs', 'docs/ai', 'docs/prd', 'docs/prd/001.md', 'docs/prd/002.md', 'docs/NOTES.md', 'README.md', '.gitignore']);
  });

  it('activate() updates the shared selection, which re-marks the rows', () => {
    expect(row('README.md')?.selected).toBe(false);

    workbench.explorerFt.activate('README.md');

    expect(workbench.selectedEntryId()).toBe('README.md');
    expect(row('README.md')).toMatchObject({ selected: true, focused: true });
    expect(row('docs/prd/001.md')?.selected).toBe(false);
  });
});
