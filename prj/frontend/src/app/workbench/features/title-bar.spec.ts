import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

/** Every button of the window's title bar does what it says (PRD 001, §15.1). */
describe('the title bar', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  const action = (id: string) => workbench.chromeFt.titleBarActions().find((candidate) => candidate.id === id);

  it('runs a command of the table for every button, and every menu row', () => {
    const commands = new Set(workbench.commandsFt.allCommands().map((command) => command.id));
    const handledByMenu = new Set(['go.local', 'go.remote']);
    const rows = workbench.mockWorkbench.menuItems.flatMap((menu) => menu.items ?? []).map((item) => item.id);

    expect(rows.filter((id) => !commands.has(id) && !handledByMenu.has(id))).toEqual([]);
    expect(
      (workbench.config.titleBarActions ?? []).map((button) => button.id).filter((id) => {
        const run = vi.spyOn(workbench.commandsFt, 'run').mockImplementation(() => undefined);
        workbench.chromeFt.runTitleBarAction(id);
        const ran = run.mock.calls[0]?.[0];
        run.mockRestore();
        return ran === undefined || !commands.has(ran);
      }),
    ).toEqual([]);
  });

  it('hides and shows the Explorer and Details, pressed while shown', () => {
    expect(action('toggle-left')?.active).toBe(true);
    expect(action('toggle-right')?.active).toBe(true);

    workbench.chromeFt.runTitleBarAction('toggle-left');
    expect(workbench.chromeFt.isShown('explorer')).toBe(false);
    expect(action('toggle-left')?.active).toBe(false);

    workbench.chromeFt.runTitleBarAction('toggle-right');
    expect(workbench.chromeFt.isShown('details')).toBe(false);
    expect(workbench.chromeFt.hiddenSidebars()).toEqual(['explorer', 'details']);

    workbench.chromeFt.runTitleBarAction('toggle-left');
    workbench.chromeFt.runTitleBarAction('toggle-right');
    expect(workbench.chromeFt.hiddenSidebars()).toEqual([]);
  });

  it('shows the bottom panel button pressed while the panel is open', () => {
    expect(action('toggle-panel')?.active).toBe(false);
    workbench.chromeFt.runTitleBarAction('toggle-panel');
    expect(action('toggle-panel')?.active).toBe(true);
  });

  it('draws a sidebar’s button on the side it is on', () => {
    expect(action('toggle-left')?.icon).toBe('sidebar-left');
    workbench.preferencesFt.choose('workbench.explorerLocation', 'right');
    expect(action('toggle-left')?.icon).toBe('sidebar-right');
  });

  it('leaves a hidden sidebar out of the Ctrl+Tab ring', () => {
    expect(workbench.focusCycleFt.ring()).toContain('explorer');
    workbench.chromeFt.toggleSidebar('explorer');
    expect(workbench.focusCycleFt.ring()).not.toContain('explorer');
    expect(workbench.focusCycleFt.ring()).toContain('details');
  });

  it('brings the Explorer back for what shows in it', () => {
    workbench.chromeFt.toggleSidebar('explorer');
    workbench.chromeFt.selectActivity('bookmarks');
    expect(workbench.chromeFt.isShown('explorer')).toBe(true);
  });

  it('hands the keyboard to the active panel when the sidebar it was in goes', () => {
    const region = document.createElement('div');
    region.setAttribute('data-focus-region', 'details');
    const button = document.createElement('button');
    region.appendChild(button);
    document.body.appendChild(region);
    button.focus();
    const focusBody = vi.spyOn(workbench.panelFocusFt, 'focusBody');

    workbench.chromeFt.toggleSidebar('explorer');
    expect(focusBody).not.toHaveBeenCalled();
    workbench.chromeFt.toggleSidebar('details');
    expect(focusBody).toHaveBeenCalledWith(workbench.activeGroupId());
    region.remove();
  });
});
