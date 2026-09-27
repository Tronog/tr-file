import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiKeybindingsTable, UiSettingsEditor } from '@tr-file/ui';
import type { UiKeybindingRequest, UiKeybindingRow, UiSettingChange, UiSettingsEditorModel } from '@tr-file/ui';

/**
 * PRD 010 — the settings window as the library draws it: its sections, its
 * settings and their controls (§1), and the Keyboard Shortcuts table and its
 * recorder (§2). The components only report; the specs check what.
 */

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
}

const SETTINGS: UiSettingsEditorModel = {
  sections: [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts', icon: 'keyboard' },
  ],
  active: 'general',
  query: '',
  page: {
    kind: 'settings',
    groups: [
      {
        id: 'files',
        title: 'Files',
        settings: [
          { id: 'files.showHidden', category: 'Files', title: 'Show Hidden Files', description: 'Dot files too.', control: { kind: 'boolean', value: false } },
          { id: 'files.thumbnails', category: 'Files', title: 'Thumbnails', description: 'Pictures.', control: { kind: 'boolean', value: false }, modified: true },
          { id: 'window.resetLayout', category: 'Window', title: 'Reset Layout', description: 'Start over.', control: { kind: 'action', label: 'Reset Layout' } },
        ],
      },
    ],
  },
};

const ROWS: readonly UiKeybindingRow[] = [
  { id: 'a', command: 'edit.search', category: 'Edit', label: 'Search Files…', key: 'Ctrl+Shift+F', when: 'Anywhere', source: 'Default' },
  { id: 'b', command: 'file.emptyTrash', category: 'File', label: 'Empty Trash…', key: null, when: '', source: 'Default' },
];

describe('UiSettingsEditor', () => {
  let fixture: ComponentFixture<UiSettingsEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSettingsEditor] }).compileComponents();
    fixture = TestBed.createComponent(UiSettingsEditor);
    fixture.componentRef.setInput('model', SETTINGS);
    fixture.detectChanges();
  });

  const host = (): HTMLElement => fixture.nativeElement;

  it('lists the sections, the active one current, and a page of settings as VS Code writes them', () => {
    const toc = Array.from(host().querySelectorAll('.toc-item'));
    expect(toc.map((item) => item.textContent?.trim())).toEqual(['General', 'Keyboard Shortcuts']);
    expect(toc[0]?.getAttribute('aria-current')).toBe('page');

    expect(host().querySelector('.group-title')?.textContent).toBe('Files');
    expect(host().querySelector('.setting-title')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Files: Show Hidden Files');
    expect(host().querySelectorAll('.setting.is-modified')).toHaveLength(1);
  });

  it('reports a section chosen, a search, a switch, a reset and an action', () => {
    const sections: string[] = [];
    const queries: string[] = [];
    const changes: UiSettingChange[] = [];
    const resets: string[] = [];
    const actions: string[] = [];
    fixture.componentInstance.sectionSelect.subscribe((id) => sections.push(id));
    fixture.componentInstance.queryChange.subscribe((text) => queries.push(text));
    fixture.componentInstance.settingChange.subscribe((change) => changes.push(change));
    fixture.componentInstance.settingReset.subscribe((id) => resets.push(id));
    fixture.componentInstance.settingAction.subscribe((id) => actions.push(id));

    (host().querySelectorAll('.toc-item')[1] as HTMLButtonElement).click();
    const search = host().querySelector('ui-search-field input') as HTMLInputElement;
    search.value = 'hid';
    search.dispatchEvent(new Event('input'));
    (host().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    (host().querySelector('.reset') as HTMLButtonElement).click();
    (host().querySelector('.setting button[uiButton]') as HTMLButtonElement).click();

    expect(sections).toEqual(['keyboard-shortcuts']);
    expect(queries).toEqual(['hid']);
    expect(changes).toEqual([{ id: 'files.showHidden', value: true }]);
    expect(resets).toEqual(['files.thumbnails']);
    expect(actions).toEqual(['window.resetLayout']);
  });

  it('names each switch by its setting, and says so when a search finds nothing', () => {
    const box = host().querySelector('input[type="checkbox"]') as HTMLInputElement;
    const title = host().querySelector(`#${box.getAttribute('aria-labelledby')}`);
    expect(title?.textContent).toContain('Show Hidden Files');

    fixture.componentRef.setInput('model', { ...SETTINGS, query: 'zzz', page: { kind: 'settings', groups: [] } });
    fixture.detectChanges();
    expect(host().querySelector('.no-results')?.textContent).toContain('No settings found');
  });

  it('shows the keybindings table on its page, with Reset All only when something changed', () => {
    fixture.componentRef.setInput('model', {
      ...SETTINGS,
      active: 'keyboard-shortcuts',
      page: { kind: 'keybindings', rows: ROWS, recording: null, modified: false },
    });
    fixture.detectChanges();

    expect(host().querySelectorAll('ui-keybindings-table tbody tr')).toHaveLength(2);
    expect((host().querySelector('.keybindings-head button') as HTMLButtonElement).disabled).toBe(true);
    expect((host().querySelector('ui-search-field input') as HTMLInputElement).placeholder).toBe('Type to search in keybindings');
  });
});

describe('UiKeybindingsTable', () => {
  let fixture: ComponentFixture<UiKeybindingsTable>;
  let requests: UiKeybindingRequest[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiKeybindingsTable] }).compileComponents();
    fixture = TestBed.createComponent(UiKeybindingsTable);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.detectChanges();
    requests = [];
    fixture.componentInstance.request.subscribe((request) => requests.push(request));
  });

  const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));

  it('draws a key as key caps, and a command with none as a dash', () => {
    expect(Array.from(rows()[0]?.querySelectorAll('.key') ?? []).map((cap) => cap.textContent)).toEqual(['Ctrl', 'Shift', 'F']);
    expect(rows()[1]?.querySelector('.none')).not.toBeNull();
  });

  it('asks to change a key on Enter or a double click, to remove it on Delete, and moves with the arrows', () => {
    rows()[0]?.dispatchEvent(keydown('Enter'));
    rows()[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    rows()[0]?.dispatchEvent(keydown('Delete'));
    // Nothing to remove on a command bound to nothing.
    rows()[1]?.dispatchEvent(keydown('Delete'));
    rows()[0]?.dispatchEvent(keydown('ArrowDown'));

    expect(requests).toEqual([
      { rowId: 'a', action: 'change' },
      { rowId: 'a', action: 'change' },
      { rowId: 'a', action: 'remove' },
    ]);
    expect(document.activeElement).toBe(rows()[1]);
  });

  describe('recording', () => {
    let recorded: string[];
    let accepted: number;
    let cancelled: number;

    beforeEach(() => {
      recorded = [];
      accepted = 0;
      cancelled = 0;
      fixture.componentInstance.record.subscribe((chord) => recorded.push(chord));
      fixture.componentInstance.accept.subscribe(() => (accepted += 1));
      fixture.componentInstance.cancel.subscribe(() => (cancelled += 1));
      fixture.componentRef.setInput('recording', { rowId: 'a', mode: 'change', key: null, conflicts: [] });
      fixture.detectChanges();
    });

    const recorder = (): HTMLElement => fixture.nativeElement.querySelector('.recorder');

    it('takes the keyboard, and reports each chord pressed', () => {
      expect(document.activeElement).toBe(recorder());

      recorder().dispatchEvent(keydown('F', { ctrlKey: true, altKey: true }));
      recorder().dispatchEvent(keydown('F5'));

      expect(recorded).toEqual(['Ctrl+Alt+F', 'F5']);
    });

    it('records Enter as the first key, and accepts with it once a key is recorded', () => {
      recorder().dispatchEvent(keydown('Enter'));
      fixture.componentRef.setInput('recording', { rowId: 'a', mode: 'change', key: 'F5', conflicts: ['File: Copy To…'] });
      fixture.detectChanges();
      recorder().dispatchEvent(keydown('Enter'));

      expect(recorded).toEqual(['Enter']);
      expect(accepted).toBe(1);
      expect(recorder().querySelector('.recorder-conflict')?.textContent).toContain('1 existing command has this keybinding: File: Copy To…');
    });

    it('gives up on Escape, which goes no further — the settings stay open', () => {
      let escaped = false;
      fixture.nativeElement.addEventListener('keydown', () => (escaped = true));
      const event = keydown('Escape');
      recorder().dispatchEvent(event);

      expect(cancelled).toBe(1);
      expect(escaped).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it('hands the keyboard back to the row once it is over', () => {
      fixture.componentRef.setInput('recording', null);
      fixture.detectChanges();

      expect(document.activeElement).toBe(rows()[0]);
    });
  });
});
