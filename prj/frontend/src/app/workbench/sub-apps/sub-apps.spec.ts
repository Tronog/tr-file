import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { settled } from '../testing/fs-fixtures';
import { Workbench } from '../workbench';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 001, §1.1 — the sub-applications share the title, activity and status
 * bars; the sidebars and the centre are the one shown.
 */
describe('Sub-applications in the window', () => {
  const setUp = async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Workbench);
    fixture.detectChanges();
    await settled();
    const workbench = TestBed.inject(WorkbenchService);
    const host = fixture.nativeElement as HTMLElement;
    const render = async () => {
      fixture.detectChanges();
      await settled();
    };
    return { workbench, host, render };
  };

  const hiddenSidebars = (host: HTMLElement) => Array.from(host.querySelectorAll('ui-workbench .sidebar')).map((sidebar) => sidebar.classList.contains('is-hidden'));

  it('draws the file manager in the sidebars and the centre, and swaps the centre for another', async () => {
    const { workbench, host, render } = await setUp();
    const center = host.querySelector('ui-workbench .center') as HTMLElement;
    expect(center.querySelector('.editor-area ui-panel-grid')).not.toBeNull();
    expect(host.querySelector('ui-workbench .sidebar app-file-manager-explorer ui-sidebar')).not.toBeNull();
    expect(host.querySelector('ui-workbench .sidebar app-file-manager-details ui-sidebar')).not.toBeNull();
    expect(center.querySelector('app-disk-usage-app')).toBeNull();
    expect(hiddenSidebars(host)).toEqual([false, false]);

    workbench.diskUsageFt.open('docs');
    await render();
    const diskUsage = center.querySelector('app-disk-usage-app') as HTMLElement;
    expect(diskUsage.classList.contains('is-inactive')).toBe(false);
    // Its own panels, the folder in a tab of them (PRD 013).
    expect(diskUsage.querySelector('ui-panel-grid ui-panel-group ui-disk-usage')).not.toBeNull();
    expect(diskUsage.querySelector('ui-tab-bar, [role="tablist"]')?.textContent).toContain('docs');
    // The file manager is kept, out of sight; its sidebars go with it.
    expect(center.querySelector('.editor-area')?.classList.contains('is-inactive')).toBe(true);
    expect(hiddenSidebars(host)).toEqual([true, true]);
    // The shared bars stay.
    expect(host.querySelector('ui-title-bar')).not.toBeNull();
    expect(host.querySelector('ui-activity-bar')).not.toBeNull();
    expect(host.querySelector('ui-status-bar')).not.toBeNull();

    workbench.chromeFt.selectActivity('file-manager');
    await render();
    expect(center.querySelector('.editor-area')?.classList.contains('is-inactive')).toBe(false);
    expect(diskUsage.isConnected && diskUsage.classList.contains('is-inactive')).toBe(true);
    expect(hiddenSidebars(host)).toEqual([false, false]);
  });

  it('marks the shown one in the activity bar, the file manager\'s own buttons set apart', async () => {
    const { workbench, host, render } = await setUp();
    workbench.subAppsFt.show('search');
    await render();
    const pressed = Array.from(host.querySelectorAll('ui-activity-bar .activity-btn[aria-pressed="true"]')).map((button) => button.getAttribute('title'));
    expect(pressed).toEqual(['Search']);
    expect(host.querySelectorAll('ui-activity-bar .activity-separator')).toHaveLength(1);
    expect(host.querySelector('app-search-app')?.textContent).toContain('Search is not available yet');
  });
});
