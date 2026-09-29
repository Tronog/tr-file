import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';
import { SidebarPanesFeature } from './sidebar-panes.feature';

/** PRD 001, §9.2 — the sidebars' `…` menus show and hide their panes. */
describe('SidebarPanesFeature — shown panes', () => {
  let workbench: WorkbenchService;
  const panes = (): SidebarPanesFeature => workbench.sidebarPanesFt;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  it('shows every pane to begin with but Permissions', () => {
    expect(panes().shown('explorer')).toEqual(['places', 'bookmarks', 'recent', 'explorer-tree']);
    expect(panes().shown('details')).toEqual(['git', 'properties', 'open-with']);
    expect(panes().hiddenIds()).toEqual(['permissions']);
  });

  it('hides and shows a pane, keeping its place in the order', () => {
    panes().toggleShown('recent');
    expect(panes().shown('explorer')).toEqual(['places', 'bookmarks', 'explorer-tree']);
    expect(panes().order('explorer')).toEqual(['places', 'bookmarks', 'recent', 'explorer-tree']);
    expect(panes().hiddenIds()).toEqual(['permissions', 'recent']);

    panes().toggleShown('recent');
    expect(panes().shown('explorer')).toEqual(['places', 'bookmarks', 'recent', 'explorer-tree']);
  });

  it('never hides the last pane a sidebar shows', () => {
    ['places', 'bookmarks', 'recent'].forEach((id) => panes().toggleShown(id));
    expect(panes().canHide('explorer-tree')).toBe(false);
    panes().toggleShown('explorer-tree');
    expect(panes().shown('explorer')).toEqual(['explorer-tree']);
    // The other sidebar is its own.
    expect(panes().canHide('git')).toBe(true);
  });

  it('ignores what is not a sidebar pane', () => {
    panes().toggleShown('search-results');
    expect(panes().hiddenIds()).toEqual(['permissions']);
  });

  it('puts the card above the first pane shown about the entry, or last when there is none', () => {
    expect(panes().detailsCardBefore()).toBe('properties');
    panes().toggleShown('permissions');
    panes().toggleShown('properties');
    expect(panes().detailsCardBefore()).toBe('permissions');
    panes().toggleShown('permissions');
    panes().toggleShown('open-with');
    expect(panes().detailsCardBefore()).toBeUndefined();
  });

  it('restores what a session hid — but never a whole sidebar, nor names it does not know', () => {
    panes().restoreHidden(['recent', 'nonsense', 'git', 'properties', 'permissions', 'open-with']);
    expect(panes().hiddenIds()).toEqual(['recent']);
    panes().restoreHidden(['permissions', 'places']);
    expect(panes().hiddenIds()).toEqual(['permissions', 'places']);
  });

  describe('the … menu', () => {
    const menu = () => workbench.contextMenuFt.menu();

    it('lists a sidebar’s panes in their order, checked while shown', () => {
      panes().move('details', { paneId: 'git', targetId: 'open-with', position: 'after' });
      workbench.contextMenuFt.openSidebarMenu('details', 30, 40);

      expect(menu()).toMatchObject({ x: 30, y: 40 });
      expect(menu()?.items.map((item) => [item.label, item.checked])).toEqual([
        ['Properties', true],
        ['Permissions', false],
        ['Actions', true],
        ['Git', true],
      ]);
    });

    it('names the tree as its header does, and hides a pane when a row is chosen', () => {
      workbench.contextMenuFt.openSidebarMenu('explorer', 0, 0);
      expect(menu()?.items.at(-1)?.label).toBe(workbench.explorerFt.title);

      workbench.contextMenuFt.run('view.pane.bookmarks');
      expect(menu()).toBeNull();
      expect(panes().isShown('bookmarks')).toBe(false);
    });

    it('turns off the row that would hide the last pane shown', () => {
      ['places', 'bookmarks', 'recent'].forEach((id) => panes().toggleShown(id));
      workbench.contextMenuFt.openSidebarMenu('explorer', 0, 0);
      const rows = menu()?.items ?? [];
      expect(rows.find((item) => item.id === 'view.pane.explorer-tree')?.disabled).toBe(true);
      expect(rows.find((item) => item.id === 'view.pane.places')?.disabled).toBeUndefined();
    });
  });
});
