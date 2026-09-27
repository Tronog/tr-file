import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';

/** PRD 002, §2.6 — `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` between panels and panes. */
describe('FocusCycleFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  const cycle = () => workbench.focusCycleFt;
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: 'Tab', ...init });
  const group = () => workbench.activeGroupId();

  it('rings the explorer, each panel, the bottom panel while open, and the details', () => {
    expect(cycle().ring()).toEqual(['explorer', `group:${group()}`, 'details']);

    workbench.bottomPanelFt.select('transfers');
    expect(cycle().ring()).toEqual(['explorer', `group:${group()}`, 'bottom', 'details']);
  });

  it('lists panels in layout order, a split one after the other', () => {
    const first = group();
    workbench.editorGroupsFt.runAction(first, 'split-right');
    const ids = workbench.panelLayoutFt.groupIds();

    expect(ids).toHaveLength(2);
    expect(cycle().ring()).toEqual(['explorer', ...ids.map((id) => `group:${id}`), 'details']);
  });

  it('steps forward and back, wrapping at either end', () => {
    const panel = `group:${group()}`;

    expect(cycle().sequence('explorer', 1)).toEqual([panel, 'details']);
    expect(cycle().sequence('details', 1)).toEqual(['explorer', panel]);
    expect(cycle().sequence('explorer', -1)).toEqual(['details', panel]);
  });

  it('starts at the active panel from outside every region', () => {
    expect(cycle().sequence(null, 1)[0]).toBe(`group:${group()}`);
  });

  it('answers Ctrl+Tab and Ctrl+Shift+Tab, and nothing else', () => {
    expect(cycle().directionOf(key({ ctrlKey: true }))).toBe(1);
    expect(cycle().directionOf(key({ ctrlKey: true, shiftKey: true }))).toBe(-1);
    expect(cycle().directionOf(key({}))).toBe(0);
    expect(cycle().directionOf(key({ ctrlKey: true, altKey: true }))).toBe(0);
    expect(cycle().directionOf(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))).toBe(0);
  });

  it('leaves the keys alone while the palette or a window has the keyboard', () => {
    workbench.commandPaletteFt.show();
    expect(cycle().directionOf(key({ ctrlKey: true }))).toBe(0);
    workbench.commandPaletteFt.close();

    void workbench.modal.message({ message: 'hello' });
    expect(cycle().directionOf(key({ ctrlKey: true }))).toBe(0);
  });

  it('enters a panel as choosing its tab does, and leaves the rest to the view', () => {
    const before = workbench.panelFocusFt.token(group());

    expect(cycle().enter(`group:${group()}`)).toBe(true);
    expect(workbench.panelFocusFt.token(group())).toBeGreaterThan(before);
    expect(cycle().enter('explorer')).toBe(false);
  });
});
