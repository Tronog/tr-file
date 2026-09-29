import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 004, §2 — Midnight Commander in the workbench: `F1`–`F10` and the
 * status bar's strip of them, and selecting by a pattern with `+` / `-`.
 */

const ROOT = [
  fsDirectory('docs'),
  fsEntry('a.txt', { size: 10 }),
  fsEntry('b.txt', { size: 30 }),
  fsEntry('c.pdf', { size: 20 }),
];

describe('Function keys (PRD 004, §2)', () => {
  let workbench: WorkbenchService;
  const group = 'group-root';

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    const http = TestBed.inject(HttpTestingController);
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT)));
    await settled();
  });

  afterEach(() => vi.restoreAllMocks());

  const select = (paths: readonly string[], focused = paths[0]) =>
    workbench.editorGroupsFt.update(group, (state) => ({
      ...state,
      selection: [...paths],
      ...(focused === undefined ? {} : { focusedEntryId: focused }),
    }));
  const selection = () => workbench.editorGroupsFt.stateOf(group)?.selection;
  const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    workbench.keybindingsFt.handleShortcut(event);
    return event;
  };

  describe('the strip', () => {
    it('shows F1 to F9 in a browser, as Midnight Commander labels them', () => {
      expect(workbench.functionKeysFt.strip().map((key) => `${key.key} ${key.label}`)).toEqual([
        '1 Help',
        '2 Rename',
        '3 View',
        '4 Open',
        '5 Copy',
        '6 Move',
        '7 MkDir',
        '8 Delete',
        '9 Menu',
      ]);
    });

    it('dims what has nothing to act on, and names each key in full', () => {
      select([]);
      workbench.editorGroupsFt.update(group, (state) => {
        const { focusedEntryId: _cursor, ...rest } = state;
        return rest;
      });
      const strip = workbench.functionKeysFt.strip();
      const byKey = (key: string) => strip.find((candidate) => candidate.id === key);

      expect(byKey('F2')).toMatchObject({ disabled: true, title: 'Rename… (F2)' });
      expect(byKey('F5')?.disabled).toBe(true);
      expect(byKey('F7')?.disabled).toBeUndefined();

      select(['a.txt']);
      expect(workbench.functionKeysFt.strip().find((candidate) => candidate.id === 'F5')?.disabled).toBeUndefined();
    });
  });

  describe('the keys', () => {
    it('F2 renames the entry the cursor is on, even with more selected', () => {
      const rename = vi.spyOn(workbench.fileEditFt, 'rename').mockResolvedValue();
      select(['a.txt', 'b.txt'], 'b.txt');

      const event = press('F2');

      expect(event.defaultPrevented).toBe(true);
      expect(rename).toHaveBeenCalledWith('b.txt', group);
    });

    it('F5 and F6 copy and move the selection, asking where to', () => {
      const transfer = vi.spyOn(workbench.operationsFt, 'transferPaths').mockResolvedValue();
      select(['a.txt', 'b.txt']);

      press('F5');
      press('F6');

      expect(transfer.mock.calls).toEqual([
        ['copy', ['a.txt', 'b.txt'], group],
        ['move', ['a.txt', 'b.txt'], group],
      ]);
    });

    it('F3 views, F4 opens with the system, F7 makes a folder, F8 deletes for good', () => {
      const open = vi.spyOn(workbench.fileBrowserFt, 'openPath').mockImplementation(() => undefined);
      const external = vi.spyOn(workbench.systemOpenFt, 'open').mockResolvedValue();
      const folder = vi.spyOn(workbench.fileEditFt, 'createFolder').mockResolvedValue();
      const trash = vi.spyOn(workbench.operationsFt, 'trash').mockResolvedValue();
      const remove = vi.spyOn(workbench.operationsFt, 'deletePermanently').mockResolvedValue();
      select(['c.pdf']);

      for (const key of ['F3', 'F4', 'F7', 'F8']) {
        press(key);
      }

      expect(open).toHaveBeenCalledWith(group, 'c.pdf');
      expect(external).toHaveBeenCalledWith('c.pdf');
      expect(folder).toHaveBeenCalledWith('', group);
      // PRD 004, §2.1: deleted — asked first by `deletePermanently` — not moved to the trash.
      expect(remove).toHaveBeenCalledWith(['c.pdf']);
      expect(trash).not.toHaveBeenCalled();
    });

    it('F9 opens the first main menu', () => {
      press('F9');

      expect(workbench.chromeFt.menuItems().find((menu) => menu.open)?.id).toBe('file');
    });

    it('claims a key with nothing to act on, so the browser does not reload', () => {
      const transfer = vi.spyOn(workbench.operationsFt, 'transferPaths').mockResolvedValue();
      workbench.editorGroupsFt.update(group, (state) => {
        const { focusedEntryId: _cursor, ...rest } = state;
        return { ...rest, selection: [] };
      });

      expect(press('F5').defaultPrevented).toBe(true);
      expect(transfer).not.toHaveBeenCalled();
    });

    it('leaves chords and keys while a window is open alone; F10 quits nothing in a browser', () => {
      const rename = vi.spyOn(workbench.fileEditFt, 'rename').mockResolvedValue();
      const close = vi.spyOn(workbench.desktopWindow, 'close');
      select(['a.txt']);

      expect(press('F10', { shiftKey: true }).defaultPrevented).toBe(false);
      // Bound, so claimed — but Quit has no window to close.
      expect(press('F10').defaultPrevented).toBe(true);
      expect(close).not.toHaveBeenCalled();
      expect(press('F2', { ctrlKey: true }).defaultPrevented).toBe(false);

      void workbench.modal.confirm({ message: 'Open?' });
      expect(press('F2').defaultPrevented).toBe(false);
      expect(rename).not.toHaveBeenCalled();
    });

    it('a click in the strip runs the key', () => {
      const rename = vi.spyOn(workbench.fileEditFt, 'rename').mockResolvedValue();
      select(['a.txt']);

      workbench.functionKeysFt.run('F2');

      expect(rename).toHaveBeenCalledWith('a.txt', group);
    });
  });

  describe('+ and -', () => {
    it('selects the entries whose names match, keeping what was picked', async () => {
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('*.txt');
      select(['c.pdf', 'docs'], 'c.pdf');

      workbench.panelKeyboardFt.run(group, { command: 'select-pattern', entryId: 'c.pdf' });
      await settled();

      expect(selection()).toEqual(['docs', 'a.txt', 'b.txt', 'c.pdf']);
      expect(workbench.editorGroupsFt.stateOf(group)?.focusedEntryId).toBe('c.pdf');
    });

    it('starts from nothing when the only entry selected is the one the cursor is on', async () => {
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('a*');
      select(['c.pdf']);

      await workbench.fileBrowserFt.selectByPattern(group, true);

      expect(selection()).toEqual(['a.txt']);
    });

    it('unselects the entries whose names match', async () => {
      vi.spyOn(workbench.modal, 'prompt').mockResolvedValue('b.*;docs');
      select(['docs', 'a.txt', 'b.txt']);

      workbench.panelKeyboardFt.run(group, { command: 'unselect-pattern', entryId: 'a.txt' });
      await settled();

      expect(selection()).toEqual(['a.txt']);
    });

    it('offers the last pattern again, and changes nothing when cancelled', async () => {
      const prompt = vi.spyOn(workbench.modal, 'prompt').mockResolvedValueOnce('*.pdf').mockResolvedValueOnce(null);
      select(['a.txt']);

      await workbench.fileBrowserFt.selectByPattern(group, true);
      await workbench.fileBrowserFt.selectByPattern(group, false);

      expect(prompt.mock.calls[0]?.[0].value).toBe('*');
      expect(prompt.mock.calls[1]?.[0].value).toBe('*.pdf');
      expect(selection()).toEqual(['c.pdf']);
    });
  });

  /** PRD 004, §1.3.2: `Ctrl`+`Shift`+`C` in a panel runs *Copy Path*. */
  describe('Ctrl+Shift+C', () => {
    it('copies the selection when the entry is part of it, else the entry', () => {
      const copy = vi.spyOn(workbench.systemOpenFt, 'copyPaths').mockResolvedValue(true);
      select(['a.txt', 'b.txt']);

      workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'b.txt' });
      workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'c.pdf' });

      expect(copy.mock.calls).toEqual([[['a.txt', 'b.txt']], [['c.pdf']]]);
    });

    it('copies the folder the panel lists when no entry has focus', () => {
      const copy = vi.spyOn(workbench.systemOpenFt, 'copyPaths').mockResolvedValue(true);

      workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: null });

      expect(copy).toHaveBeenCalledWith(['']);
    });

    /** PRD 004, §1.3.2: twice within a second, the UNIX way — `C:\Users` as `/C/Users`. */
    describe('pressed twice', () => {
      beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
      afterEach(() => vi.useRealTimers());

      it('copies UNIX paths the second time within a second', () => {
        const copy = vi.spyOn(workbench.systemOpenFt, 'copyPaths').mockResolvedValue(true);

        workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'b.txt' });
        vi.advanceTimersByTime(600);
        workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'b.txt' });

        expect(copy.mock.calls).toEqual([[['b.txt']], [['b.txt'], 'unix']]);
      });

      it('starts over after the second press', () => {
        const copy = vi.spyOn(workbench.systemOpenFt, 'copyPaths').mockResolvedValue(true);

        for (let press = 0; press < 3; press += 1) {
          workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'b.txt' });
        }

        expect(copy.mock.calls).toEqual([[['b.txt']], [['b.txt'], 'unix'], [['b.txt']]]);
      });

      it('copies the host way again after more than a second, or for other entries', () => {
        const copy = vi.spyOn(workbench.systemOpenFt, 'copyPaths').mockResolvedValue(true);

        workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'b.txt' });
        vi.advanceTimersByTime(1001);
        workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'b.txt' });
        workbench.panelKeyboardFt.run(group, { command: 'copy-path', entryId: 'c.pdf' });

        expect(copy.mock.calls).toEqual([[['b.txt']], [['b.txt']], [['c.pdf']]]);
      });
    });

    it('shows the key beside Copy Path', () => {
      expect(workbench.commandsFt.menuItem('file.copyPath').keybinding).toBe('Ctrl+Shift+C');
    });
  });
});
