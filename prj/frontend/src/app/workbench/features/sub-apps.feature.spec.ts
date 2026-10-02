import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

/** PRD 001, §1.1 — the file manager is one of the window's sub-applications. */
describe('SubAppsFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  const activity = () => workbench.chromeFt.activityItems();

  it('starts in the file manager, the sub-applications first in the activity bar', () => {
    expect(workbench.subAppsFt.active()).toBe('file-manager');
    expect(activity().slice(0, 3)).toEqual([
      { id: 'file-manager', label: 'File Manager', icon: 'copy', active: true },
      { id: 'search', label: 'Search', icon: 'search' },
      { id: 'disk-usage', label: 'Disk Usage', icon: 'database' },
    ]);
    // The file manager's own buttons follow, set apart.
    expect(activity()[3]).toMatchObject({ id: 'transfers', separatorBefore: true });
    expect(workbench.subAppsFt.isOpened('disk-usage')).toBe(false);
  });

  it('shows another from the activity bar or the palette, and keeps it drawn once shown', () => {
    workbench.chromeFt.selectActivity('disk-usage');
    expect(workbench.subAppsFt.active()).toBe('disk-usage');
    expect(activity().find((item) => item.active)?.id).toBe('disk-usage');

    workbench.commandsFt.run('view.app.search');
    expect(workbench.subAppsFt.active()).toBe('search');
    expect(workbench.subAppsFt.isOpened('disk-usage')).toBe(true);
    expect(workbench.commandsFt.menuItem('view.app.search').checked).toBe(true);

    workbench.chromeFt.selectActivity('file-manager');
    expect(workbench.subAppsFt.fileManager()).toBe(true);
    expect(workbench.chromeFt.sidebarView()).toBe('explorer');
  });

  it('leaves the file commands nothing to act on while another is shown', () => {
    expect(workbench.commandsFt.isEnabled('file.newFolder')).toBe(true);
    expect(workbench.focusCycleFt.ring().length).toBeGreaterThan(0);

    workbench.subAppsFt.show('disk-usage');
    expect(workbench.commandsFt.activeTarget()).toMatchObject({ paths: [], folder: null });
    expect(workbench.commandsFt.isEnabled('file.newFolder')).toBe(false);
    expect(workbench.functionKeysFt.strip().find((key) => key.id === 'F7')?.disabled).toBe(true);
    // No region of the file manager's to `Ctrl`+`Tab` into.
    expect(workbench.focusCycleFt.ring()).toEqual([]);
    expect(workbench.focusCycleFt.sequence(null, 1)).toEqual([]);
  });

  it('brings the file manager forward for a folder shown, or a part of it asked for', () => {
    workbench.subAppsFt.show('search');
    workbench.openInActiveGroup('docs', 'docs');
    expect(workbench.subAppsFt.active()).toBe('file-manager');

    workbench.subAppsFt.show('search');
    workbench.chromeFt.selectActivity('transfers');
    expect(workbench.subAppsFt.active()).toBe('file-manager');
    expect(workbench.bottomPanelFt.activeTab()).toBe('transfers');

    workbench.subAppsFt.show('search');
    workbench.searchFt.show();
    expect(workbench.subAppsFt.active()).toBe('file-manager');
    expect(workbench.chromeFt.sidebarView()).toBe('search');
  });

  it('gives the keyboard back to the active panel on coming back to the file manager', () => {
    const group = workbench.activeGroupId();
    const before = workbench.panelFocusFt.token(group);
    workbench.subAppsFt.show('disk-usage');
    workbench.subAppsFt.show('file-manager');
    expect(workbench.panelFocusFt.token(group)).toBeGreaterThan(before);
  });

  it('opens Disk Usage on a folder (PRD 001, §9.3.2)', () => {
    workbench.diskUsageFt.open('docs');
    expect(workbench.subAppsFt.active()).toBe('disk-usage');
    expect(workbench.diskUsageFt.folder()).toBe('docs');
  });
});
