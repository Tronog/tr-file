import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiSettingsEditorModel } from '@tr-file/ui';
import { MemorySettingsStore, SettingsService } from '../../settings/settings.service';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { PREFERENCES_KEY } from './preferences.feature';

/** PRD 010 — the settings window: its settings (§1) and its keys (§2). */
describe('Settings', () => {
  let workbench: WorkbenchService;
  let store: MemorySettingsStore;

  beforeEach(async () => {
    store = new MemorySettingsStore();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SettingsService, useValue: store }],
    });
    workbench = TestBed.inject(WorkbenchService);
    workbench.editorGroupsFt.start();
    TestBed.inject(HttpTestingController).expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsDirectory('docs'), fsEntry('a.txt')])));
    await settled();
  });

  afterEach(() => vi.restoreAllMocks());

  const editor = () => workbench.settingsEditorFt;
  const model = (): UiSettingsEditorModel => editor().model();
  const settings = () => {
    const page = model().page;
    return page.kind === 'settings' ? page.groups.flatMap((group) => group.settings) : [];
  };
  const rows = () => {
    const page = model().page;
    return page.kind === 'keybindings' ? page.rows : [];
  };

  describe('preferences (§1)', () => {
    const preferences = () => workbench.preferencesFt;

    it('keeps its own switches only while they differ from the default', () => {
      expect(preferences().value('files.thumbnails')).toBe(true);

      preferences().set('files.thumbnails', false);
      expect(store.get(PREFERENCES_KEY)).toEqual({ 'files.thumbnails': false });
      expect(preferences().isModified('files.thumbnails')).toBe(true);

      preferences().reset('files.thumbnails');
      expect(store.get(PREFERENCES_KEY)).toBeUndefined();
    });

    it('reads and writes hidden files and restoring the layout where they already live', () => {
      preferences().set('files.showHidden', true);
      preferences().set('window.restoreLayout', false);

      expect(workbench.showHidden()).toBe(true);
      expect(workbench.sessionFt.restoresSessions).toBe(false);
      expect(workbench.commandsFt.menuItem('settings.restoreSession').checked).toBe(false);
    });

    it('stops and starts auto refresh', () => {
      const stop = vi.spyOn(workbench.autoRefreshFt, 'stop');
      const start = vi.spyOn(workbench.autoRefreshFt, 'start');

      preferences().set('files.autoRefresh', false);
      preferences().set('files.autoRefresh', true);

      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('hides the function-key strip', () => {
      expect(workbench.functionKeysFt.strip().length).toBeGreaterThan(0);

      preferences().set('workbench.functionKeyBar', false);

      expect(workbench.functionKeysFt.strip()).toEqual([]);
    });

    it('makes no thumbnails while they are off', () => {
      const make = vi.spyOn(workbench.thumbnailsFt, 'canMake');
      preferences().set('files.thumbnails', false);

      workbench.thumbnailsFt.request(['a.txt']);

      expect(make).not.toHaveBeenCalled();
    });

    it('runs an action setting as its command', () => {
      const run = vi.spyOn(workbench.commandsFt, 'run').mockImplementation(() => undefined);

      preferences().run('window.resetLayout');

      expect(run).toHaveBeenCalledWith('view.resetLayout');
    });
  });

  describe('the window', () => {
    it('opens large, at the page asked for, from the gear menu and a key', () => {
      workbench.commandsFt.run('workbench.openSettings');

      const entry = workbench.modal.stack()[0];
      expect(entry).toMatchObject({ kind: 'component', label: 'Settings', size: 'large' });
      expect(model().active).toBe('general');
      expect(model().sections.map((section) => section.label)).toEqual(['General', 'Appearance', 'Keyboard Shortcuts']);

      workbench.commandsFt.run('workbench.openKeybindings');
      expect(workbench.modal.stack()).toHaveLength(1);
      expect(model().active).toBe('keyboard-shortcuts');
    });

    it('lists a page\'s settings under their headings, as they stand', () => {
      editor().open('general');
      workbench.showHidden.set(true);

      const page = model().page;
      expect(page.kind === 'settings' ? page.groups.map((group) => group.title) : []).toEqual(['Files', 'Window', 'Places']);
      expect(settings().find((setting) => setting.id === 'files.showHidden')).toMatchObject({
        category: 'Files',
        title: 'Show Hidden Files',
        control: { kind: 'boolean', value: true },
        modified: true,
      });
      expect(settings().find((setting) => setting.id === 'window.resetLayout')?.control).toEqual({ kind: 'action', label: 'Reset Layout' });
    });

    it('changes, resets and runs settings from the page', () => {
      editor().open('appearance');

      editor().changeSetting({ id: 'workbench.functionKeyBar', value: false });
      expect(settings().find((setting) => setting.id === 'workbench.functionKeyBar')?.modified).toBe(true);

      editor().resetSetting('workbench.functionKeyBar');
      expect(workbench.preferencesFt.value('workbench.functionKeyBar')).toBe(true);
    });

    it('searches every settings page at once', () => {
      editor().open('general');
      editor().setQuery('thumb');

      const page = model().page;
      expect(page.kind === 'settings' ? page.groups.map((group) => group.title) : []).toEqual(['Appearance › Files']);
      expect(settings().map((setting) => setting.id)).toEqual(['files.thumbnails']);

      editor().setQuery('nothing like this');
      expect(settings()).toEqual([]);
    });
  });

  describe('Keyboard Shortcuts (§2)', () => {
    beforeEach(() => editor().open('keyboard-shortcuts'));

    const row = (command: string, key: string | null) => rows().find((candidate) => candidate.command === command && candidate.key === key);

    it('lists every binding and every unbound command, searchable', () => {
      expect(row('view.commandPalette', 'Ctrl+P')).toMatchObject({ category: 'View', label: 'Show All Commands', when: 'Anywhere', source: 'Default' });
      expect(row('help.show', 'F1')).toMatchObject({ category: 'Help', label: 'Show Help', when: 'Anywhere', source: 'Default' });
      expect(row('file.open', 'Enter')?.when).toBe('On a row');
      expect(row('file.emptyTrash', null)).toBeDefined();

      editor().setQuery('palette');
      expect(rows().every((candidate) => candidate.command.includes('Palette') || candidate.label.toLowerCase().includes('palette') || candidate.command === 'view.commandPalette')).toBe(true);
    });

    it('records a new key for a row: shows what it conflicts with, keeps it on Enter', () => {
      const target = row('edit.search', 'Ctrl+Shift+F');
      editor().requestKeybinding({ rowId: target?.id as string, action: 'change' });
      editor().recordKey('F5');

      const page = model().page;
      expect(page.kind === 'keybindings' ? page.recording : null).toEqual({
        rowId: target?.id,
        mode: 'change',
        key: 'F5',
        conflicts: ['File: Copy To…'],
      });

      editor().acceptKey();
      expect(workbench.keybindingsFt.keysFor('edit.search')).toEqual(['F5']);
      expect(row('edit.search', 'F5')).toMatchObject({ source: 'User', modified: true });
    });

    it('gives an unbound command its first key, and adds one more to a bound one', () => {
      editor().requestKeybinding({ rowId: row('file.emptyTrash', null)?.id as string, action: 'change' });
      editor().recordKey('Ctrl+Alt+E');
      editor().acceptKey();

      editor().requestKeybinding({ rowId: row('edit.search', 'Ctrl+Shift+F')?.id as string, action: 'add' });
      editor().recordKey('Ctrl+Alt+F');
      editor().acceptKey();

      expect(workbench.keybindingsFt.keysFor('file.emptyTrash')).toEqual(['Ctrl+Alt+E']);
      expect(workbench.keybindingsFt.keysFor('edit.search')).toEqual(['Ctrl+Shift+F', 'Ctrl+Alt+F']);
    });

    it('changes nothing when recording is given up, or nothing was pressed', () => {
      const target = row('edit.search', 'Ctrl+Shift+F')?.id as string;
      editor().requestKeybinding({ rowId: target, action: 'change' });
      editor().recordKey('F5');
      editor().cancelRecording();
      editor().requestKeybinding({ rowId: target, action: 'change' });
      editor().acceptKey();

      expect(workbench.keybindingsFt.keysFor('edit.search')).toEqual(['Ctrl+Shift+F']);
    });

    it('removes a key, resets a command, and resets them all', () => {
      editor().requestKeybinding({ rowId: row('edit.search', 'Ctrl+Shift+F')?.id as string, action: 'remove' });
      expect(workbench.keybindingsFt.keysFor('edit.search')).toEqual([]);
      const page = model().page;
      expect(page.kind === 'keybindings' && page.modified).toBe(true);

      editor().requestKeybinding({ rowId: row('edit.search', null)?.id as string, action: 'reset' });
      expect(workbench.keybindingsFt.keysFor('edit.search')).toEqual(['Ctrl+Shift+F']);

      workbench.keybindingsFt.add('edit.search', 'F12');
      editor().resetAllKeybindings();
      expect(workbench.keybindingsFt.keysFor('edit.search')).toEqual(['Ctrl+Shift+F']);
    });
  });
});
