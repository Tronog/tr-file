import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiCheatsheet, UiHelp } from '@tr-file/ui';
import { settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 001, §16 — `F1` opens the Help window, whose *Cheatsheet* tab (§16.1)
 * shows every key in coloured cards, from the key table as the user has it.
 */
describe('HelpFeature (PRD 001, §16)', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  afterEach(() => TestBed.inject(HttpTestingController).match(() => true));

  const press = (key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    workbench.keybindingsFt.handleShortcut(event);
    return event;
  };

  const section = (id: string) => workbench.helpFt.sections().find((candidate) => candidate.id === id);
  const labels = (id: string) => section(id)?.rows.map((row) => row.label) ?? [];

  it('opens on F1, at the cheatsheet, as a large modal window', async () => {
    const open = vi.spyOn(workbench.modal, 'open');
    expect(press('F1').defaultPrevented).toBe(true);
    expect(workbench.helpFt.isOpen()).toBe(true);
    expect(workbench.helpFt.activeTab()).toBe('cheatsheet');
    expect(open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ label: 'Help', size: 'large' }));
    expect(workbench.commandPaletteFt.isOpen()).toBe(false);

    // Open already: F1 is not taken again, and a second window never opens.
    workbench.helpFt.open();
    expect(open).toHaveBeenCalledTimes(1);

    for (const entry of workbench.modal.stack()) {
      workbench.modal.dismiss(entry.id);
    }
    await settled();
    expect(workbench.helpFt.isOpen()).toBe(false);
  });

  it('is in the Help menu', () => {
    const help = workbench.chromeFt.menuItems().find((menu) => menu.id === 'help');
    expect(help?.items?.map((item) => item.id)).toEqual(['help.show', 'help.cheatsheet']);
  });

  it('draws a card per subject, each its own colour, the configurable ones first', () => {
    const sections = workbench.helpFt.sections();
    expect(sections.map((candidate) => candidate.id).slice(0, 6)).toEqual(['window', 'function-keys', 'panels', 'files', 'selection', 'image']);
    expect(section('window')?.hue).not.toBe(section('function-keys')?.hue);
    expect(section('listing')?.note).toContain('not configurable');

    expect(labels('function-keys')[0]).toBe('Show Help');
    expect(section('function-keys')?.rows[0]?.keys).toEqual([['F1']]);
    expect(section('window')?.rows[0]).toMatchObject({ label: 'Show All Commands', keys: [['Ctrl', 'Shift', 'P'], ['Ctrl', 'P']] });
    // A key of a row says so; `Plus` is drawn as `+`.
    expect(section('selection')?.rows.find((row) => row.id === 'selection.byPattern|list')).toMatchObject({ keys: [['+']], where: 'on a row' });
    // The function keys are on their own card, not again under their commands.
    expect(labels('files')).not.toContain('Rename…');
  });

  it('shows the keys as the user has them', () => {
    workbench.keybindingsFt.add('edit.search', 'Ctrl+Alt+S', 'window');
    expect(section('window')?.rows.find((row) => row.id === 'edit.search|window')?.keys).toEqual([
      ['Ctrl', 'Shift', 'F'],
      ['Ctrl', 'Alt', 'S'],
    ]);
    workbench.keybindingsFt.resetAll();
  });

  it('narrows the cards to what the search matches', () => {
    workbench.helpFt.setQuery('zoom out');
    expect(workbench.helpFt.cheatsheet().map((candidate) => candidate.id)).toEqual(['image', 'zoom']);
    expect(workbench.helpFt.cheatsheet()[0]?.rows.map((row) => row.label)).toEqual(['Zoom Out']);

    // A card whose title matches stays whole.
    workbench.helpFt.setQuery('dialogs');
    expect(workbench.helpFt.cheatsheet()[0]?.rows.length).toBe(section('dialogs')?.rows.length);

    // Keys match too.
    workbench.helpFt.setQuery('ctrl+t');
    expect(workbench.helpFt.cheatsheet().flatMap((candidate) => candidate.rows.map((row) => row.label))).toContain('New Tab');

    workbench.helpFt.setQuery('nothing like this');
    expect(workbench.helpFt.cheatsheet()).toEqual([]);
  });
});

describe('UiHelp and UiCheatsheet', () => {
  it('draw the tabs, the cards and their keycaps', () => {
    TestBed.configureTestingModule({});
    const help = TestBed.createComponent(UiHelp);
    help.componentRef.setInput('tabs', [{ id: 'cheatsheet', label: 'Cheatsheet' }]);
    help.componentRef.setInput('activeTab', 'cheatsheet');
    help.detectChanges();
    const tab = (help.nativeElement as HTMLElement).querySelector('[role="tab"]');
    expect(tab?.getAttribute('aria-selected')).toBe('true');
    expect((help.nativeElement as HTMLElement).querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tab?.id);

    const sheet = TestBed.createComponent(UiCheatsheet);
    sheet.componentRef.setInput('sections', [
      { id: 'a', title: 'Window', hue: 'green', rows: [{ id: 'r', keys: [['Ctrl', 'P'], ['F1']], label: 'Palette' }] },
    ]);
    sheet.detectChanges();
    const host = sheet.nativeElement as HTMLElement;
    expect(host.querySelector('.card')?.getAttribute('data-hue')).toBe('green');
    expect([...host.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['Ctrl', 'P', 'F1']);
    expect(host.querySelector('.or')?.textContent).toBe('or');

    sheet.componentRef.setInput('sections', []);
    sheet.componentRef.setInput('empty', 'Nothing here.');
    sheet.detectChanges();
    expect(host.querySelector('.empty')?.textContent?.trim()).toBe('Nothing here.');
  });
});
