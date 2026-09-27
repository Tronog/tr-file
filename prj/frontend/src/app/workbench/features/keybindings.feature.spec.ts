import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiFileList, UiKeymap, chordOf, isChord } from '@tr-file/ui';
import type { UiPanelKey } from '@tr-file/ui';
import { MemorySettingsStore, SettingsService } from '../../settings/settings.service';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { KEYBINDINGS_KEY } from './keybindings.feature';

/** PRD 010, §2 — every key configurable, from one table. */

const key = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });

describe('chordOf', () => {
  it('writes modifiers in order, letters in capitals, and names the keys', () => {
    expect(chordOf(key('p', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P');
    expect(chordOf(key('p', { metaKey: true }))).toBe('Ctrl+P');
    expect(chordOf(key('ArrowLeft', { altKey: true }))).toBe('Alt+Left');
    expect(chordOf(key(' ', { ctrlKey: true }))).toBe('Ctrl+Space');
    expect(chordOf(key('F5'))).toBe('F5');
    expect(chordOf(key('Tab', { shiftKey: true }))).toBe('Shift+Tab');
  });

  it('writes a symbol as typed, without the Shift it took', () => {
    expect(chordOf(key('*', { shiftKey: true }))).toBe('*');
    expect(chordOf(key('+', { shiftKey: true }))).toBe('Plus');
    expect(chordOf(key(',', { ctrlKey: true }))).toBe('Ctrl+,');
  });

  it('is nothing for a modifier on its own', () => {
    expect(chordOf(key('Shift', { shiftKey: true }))).toBeNull();
    expect(chordOf(key('Control', { ctrlKey: true }))).toBeNull();
  });

  it('knows a well-formed chord', () => {
    expect(isChord('Ctrl+Shift+P')).toBe(true);
    expect(isChord('Shift+Ctrl+P')).toBe(false);
    expect(isChord('Ctrl+')).toBe(false);
    expect(isChord('Ctrl')).toBe(false);
  });
});

describe('KeybindingsFeature (PRD 010, §2)', () => {
  let workbench: WorkbenchService;
  let store: MemorySettingsStore;
  const group = 'group-root';

  const setUp = async (stored?: unknown): Promise<void> => {
    store = new MemorySettingsStore();
    if (stored !== undefined) {
      store.set(KEYBINDINGS_KEY, stored);
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SettingsService, useValue: store }],
    });
    workbench = TestBed.inject(WorkbenchService);
    workbench.editorGroupsFt.start();
    TestBed.inject(HttpTestingController).expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsDirectory('docs'), fsEntry('a.txt')])));
    await settled();
  };

  afterEach(() => vi.restoreAllMocks());

  const keys = () => workbench.keybindingsFt;
  const keymap = () => TestBed.inject(UiKeymap);

  it("starts with the library's keys and the window's, and hands them to the keymap", async () => {
    await setUp();

    expect(keys().keysFor('view.commandPalette')).toEqual(['Ctrl+Shift+P', 'F1', 'Ctrl+P']);
    expect(keys().keysFor('file.trash')).toEqual(['Delete', 'F8']);
    expect(keymap().keysFor('file.open', 'list')).toEqual(['Enter']);
  });

  it('shows the key in force beside a command: a panel key first, then a row key, then the window', async () => {
    await setUp();

    expect(workbench.commandsFt.menuItem('go.up').keybinding).toBe('Alt+Up');
    expect(workbench.commandsFt.menuItem('file.trash').keybinding).toBe('Delete');
    expect(workbench.commandsFt.menuItem('file.rename').keybinding).toBe('F2');
    expect(workbench.commandsFt.menuItem('selection.byPattern').keybinding).toBe('+');
  });

  it('changes a key: the old one stops working and the new one works, and it is remembered', async () => {
    await setUp();
    const rename = vi.spyOn(workbench.fileEditFt, 'rename').mockResolvedValue();
    workbench.fileBrowserFt.selectEntry(group, 'a.txt');

    keys().change({ command: 'file.rename', key: 'F2', when: 'window' }, 'Ctrl+E');
    const old = key('F2');
    keys().handleShortcut(old);
    keys().handleShortcut(key('e', { ctrlKey: true }));

    expect(old.defaultPrevented).toBe(false);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(workbench.commandsFt.menuItem('file.rename').keybinding).toBe('Ctrl+E');
    expect(store.get(KEYBINDINGS_KEY)).toEqual({
      removed: [{ command: 'file.rename', key: 'F2', when: 'window' }],
      added: [{ command: 'file.rename', key: 'Ctrl+E', when: 'window' }],
    });
  });

  it('reaches the library: a row answers the key it was given', async () => {
    await setUp();
    keys().add('file.open', 'O');

    const fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', [{ key: 'name', label: 'Name' }]);
    fixture.componentRef.setInput('rows', [{ id: 'a.txt', name: 'a.txt', icon: 'file', cells: {} }]);
    fixture.detectChanges();
    const commands: UiPanelKey[] = [];
    fixture.componentInstance.command.subscribe((command) => commands.push(command));

    (fixture.nativeElement.querySelector('tbody tr') as HTMLElement).dispatchEvent(key('o'));

    expect(commands).toEqual([{ command: 'open', entryId: 'a.txt' }]);
  });

  it('moves the function-key strip with the key', async () => {
    await setUp();
    keys().change({ command: 'file.copyTo', key: 'F5', when: 'window' }, 'F11');
    keys().add('view.refresh', 'F5', 'window');

    const strip = workbench.functionKeysFt.strip();
    expect(strip.find((candidate) => candidate.id === 'F5')?.title).toBe('Refresh (F5)');
  });

  it('adds, removes, resets one command and all of them', async () => {
    await setUp();

    keys().add('workbench.openKeybindings', 'Ctrl+Alt+K');
    expect(keys().keysFor('workbench.openKeybindings')).toEqual(['Ctrl+Alt+K']);

    keys().remove({ command: 'edit.search', key: 'Ctrl+Shift+F', when: 'window' });
    expect(keys().keysFor('edit.search')).toEqual([]);

    keys().reset('edit.search');
    expect(keys().keysFor('edit.search')).toEqual(['Ctrl+Shift+F']);

    keys().resetAll();
    expect(keys().keysFor('workbench.openKeybindings')).toEqual([]);
    expect(store.get(KEYBINDINGS_KEY)).toBeUndefined();
  });

  it('gives a removed default back as the default, not as an addition', async () => {
    await setUp();
    const binding = { command: 'edit.search', key: 'Ctrl+Shift+F', when: 'window' } as const;

    keys().remove(binding);
    keys().add('edit.search', 'Ctrl+Shift+F', 'window');

    expect(store.get(KEYBINDINGS_KEY)).toBeUndefined();
  });

  it('says which other commands a key already runs there', async () => {
    await setUp();

    expect(keys().conflicts('F5', 'window', 'view.refresh')).toEqual(['file.copyTo']);
    expect(keys().conflicts('F5', 'panel', 'view.refresh')).toEqual([]);
  });

  it('restores what was stored, and drops what is not a binding', async () => {
    await setUp({
      removed: [{ command: 'edit.search', key: 'Ctrl+Shift+F', when: 'window' }],
      added: [{ command: 'edit.search', key: 'Ctrl+Alt+F', when: 'window' }, { command: 'x', key: 'Y', when: 'nowhere' }, 'junk'],
    });

    expect(keys().keysFor('edit.search')).toEqual(['Ctrl+Alt+F']);
    expect(keys().bindings().some((binding) => binding.command === 'x')).toBe(false);
  });

  it('lists every command, bound or not, with where its key applies and where it came from', async () => {
    await setUp();
    keys().add('workbench.openKeybindings', 'Ctrl+Alt+K');

    const entries = keys().entries();
    expect(entries.find((entry) => entry.command === 'workbench.openKeybindings')).toMatchObject({ source: 'User', modified: true });
    expect(entries.find((entry) => entry.command === 'file.emptyTrash')).toMatchObject({ binding: null, source: 'Default' });
    expect(entries.find((entry) => entry.command === 'list.mark')).toMatchObject({ category: 'List', label: 'Mark Entry and Move Down' });
  });

  it('leaves a letter bound to the window to a text field, but not a chord', async () => {
    await setUp();
    keys().add('view.refresh', 'R', 'window');
    const field = document.createElement('input');
    document.body.appendChild(field);

    const letter = key('r');
    field.dispatchEvent(letter);
    keys().handleShortcut(letter);
    const chord = key('p', { ctrlKey: true, shiftKey: true });
    field.dispatchEvent(chord);
    keys().handleShortcut(chord);

    expect(letter.defaultPrevented).toBe(false);
    expect(chord.defaultPrevented).toBe(true);
    field.remove();
  });
});
