import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileList, UiIconView } from '@tr-file/ui';
import type {
  UiFileBrowserModel,
  UiFileColumn,
  UiFileRow,
  UiIconViewItem,
  UiPanelGroupModel,
  UiPanelKey,
  UiSelectionChange,
} from '@tr-file/ui';
import { PanelHost } from './testing/panel-host';

/**
 * PRD 001, Section 6.2 — the keyboard a panel body answers to once focus is
 * inside it. Both views are exercised through their real DOM, because the
 * behaviour under test *is* where focus lands.
 */

const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name', sort: 'asc' },
  { key: 'size', label: 'Size', width: '90px', align: 'end' },
];

/** Names chosen so type-to-find has both a prefix and a repeated initial. */
const NAMES = ['alpha.ts', 'docs', 'download.zip', 'notes.md', 'zeta.json'] as const;

const ROWS: readonly UiFileRow[] = NAMES.map((name, index) => ({
  id: name,
  name,
  icon: 'file',
  cells: { size: `${index} B` },
  ...(index === 0 ? { focused: true, selected: true } : {}),
}));

const ITEMS: readonly UiIconViewItem[] = NAMES.map((name, index) => ({
  id: name,
  label: name,
  icon: 'file',
  ...(index === 0 ? { focused: true, selected: true } : {}),
}));

/** A bubbling, cancellable `keydown`, the way the browser delivers one. */
function keydown(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}

describe('UiFileList keyboard', () => {
  let fixture: ComponentFixture<UiFileList>;
  let selected: string[];
  let commands: UiPanelKey[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileList] }).compileComponents();
    fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.detectChanges();

    selected = [];
    commands = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
    fixture.componentInstance.command.subscribe((key) => commands.push(key));
  });

  const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));

  const press = (index: number, key: string): KeyboardEvent => {
    const event = keydown(key);
    rows()[index]?.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  it('moves between rows with the arrows, Home and End', () => {
    press(0, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);

    press(1, 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);

    press(0, 'End');
    expect(document.activeElement).toBe(rows()[4]);

    press(4, 'Home');
    expect(document.activeElement).toBe(rows()[0]);
  });

  /** What makes the details sidebar track the keyboard, not just the mouse. */
  it('selects each row it moves onto', () => {
    press(0, 'ArrowDown');
    press(1, 'ArrowDown');

    expect(selected).toEqual(['docs', 'download.zip']);
  });

  it('does not move past either end', () => {
    press(0, 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);

    press(4, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[4]);
  });

  /**
   * These keys are reported, not acted on: what "open" means to the workbench
   * is `PanelKeyboardFeature`'s decision, not this table's.
   */
  it('reports Enter, Space, Backspace, Delete, + and - as panel commands', () => {
    press(2, 'Enter');
    press(2, ' ');
    press(2, 'Backspace');
    press(2, 'Delete');
    press(2, '+');
    press(2, '-');

    expect(commands).toEqual([
      { command: 'open', entryId: 'download.zip' },
      { command: 'select', entryId: 'download.zip' },
      { command: 'up', entryId: 'download.zip' },
      { command: 'delete', entryId: 'download.zip' },
      { command: 'select-pattern', entryId: 'download.zip' },
      { command: 'unselect-pattern', entryId: 'download.zip' },
    ]);
    // None of them moved the selection on their own.
    expect(selected).toEqual([]);
  });

  /** Midnight Commander's selection keys (PRD 004, §2). */
  describe('Insert and *', () => {
    let changes: UiSelectionChange[];

    beforeEach(() => {
      changes = [];
      fixture.componentInstance.selectionChange.subscribe((change) => changes.push(change));
    });

    const withSelection = (ids: readonly string[], focused: string): void => {
      fixture.componentRef.setInput(
        'rows',
        ROWS.map((row) => ({ ...row, selected: ids.includes(row.id), focused: row.id === focused })),
      );
      fixture.detectChanges();
    };

    it('Insert keeps the row the cursor alone selected, and moves on without selecting the next', () => {
      press(0, 'Insert');

      expect(changes).toEqual([{ selected: ['alpha.ts'], focused: 'docs' }]);
      expect(document.activeElement).toBe(rows()[1]);
    });

    it('Insert adds a row to what is marked, or takes a marked one out', () => {
      withSelection(['alpha.ts'], 'docs');
      press(1, 'Insert');
      withSelection(['alpha.ts', 'docs'], 'alpha.ts');
      press(0, 'Insert');

      expect(changes).toEqual([
        { selected: ['alpha.ts', 'docs'], focused: 'download.zip' },
        { selected: ['docs'], focused: 'docs' },
      ]);
    });

    it('Insert on the last row marks it and stays', () => {
      withSelection(['alpha.ts'], 'zeta.json');
      press(4, 'Insert');

      expect(changes).toEqual([{ selected: ['alpha.ts', 'zeta.json'], focused: 'zeta.json' }]);
    });

    it('* selects every row, and nothing once every row is', () => {
      press(0, '*');
      withSelection(NAMES, 'alpha.ts');
      press(0, '*');

      expect(changes).toEqual([
        { selected: [...NAMES], focused: 'alpha.ts' },
        { selected: [], focused: 'alpha.ts' },
      ]);
    });

    it('takes *, + and - as part of a name being typed', () => {
      press(0, 'a');
      press(0, '-');

      expect(commands).toEqual([]);
    });
  });

  it('narrows on each letter as a prefix is typed', () => {
    press(0, 'd');
    expect(document.activeElement).toBe(rows()[1]); // docs

    press(1, 'o');
    expect(document.activeElement).toBe(rows()[1]); // "do" still matches docs

    press(1, 'w');
    expect(document.activeElement).toBe(rows()[2]); // "dow" — download.zip
  });

  it('cycles through the entries sharing an initial when it is repeated', () => {
    press(0, 'd');
    expect(document.activeElement).toBe(rows()[1]);

    // A second `d` walks on rather than seeking a name beginning "dd".
    press(1, 'd');
    expect(document.activeElement).toBe(rows()[2]);
  });

  it('claims every key it handles, so none reaches the browser', () => {
    expect(press(0, 'ArrowDown').defaultPrevented).toBe(true);
    expect(press(1, 'PageDown').defaultPrevented).toBe(true);
    expect(press(4, 'q').defaultPrevented).toBe(true);

    // `Ctrl`+`A` is claimed now — it selects all (PRD 004, §1.2) — but a
    // chord like `Ctrl`+`T` is the panel's, and passes through untouched.
    const modified = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    rows()[0]?.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
  });

  /** `Alt`+`←`/`→` is the panel's history; the table must not swallow it. */
  it('leaves an Alt chord to the panel', () => {
    const event = keydown('ArrowDown', { altKey: true });
    rows()[0]?.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(selected).toEqual([]);
    expect(commands).toEqual([]);
  });

  /**
   * `Ctrl`+`PageDown` switches tabs (§6.2.4). The table pages its rows on a
   * bare `PageDown`, so it must not do both on its way past.
   */
  it('leaves a Ctrl chord to the panel', () => {
    const event = keydown('PageDown', { ctrlKey: true });
    rows()[0]?.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(selected).toEqual([]);
  });

  it('travels a page at a time with PageDown and PageUp', () => {
    // jsdom measures nothing, so the fallback page of ten overshoots the list
    // and clamps — which is the behaviour a short listing should have anyway.
    press(0, 'PageDown');
    expect(document.activeElement).toBe(rows()[4]);

    press(4, 'PageUp');
    expect(document.activeElement).toBe(rows()[0]);
  });

  /** PRD 002, §3.1: the keyboard never stands on a listing with nothing in hand. */
  describe('focus handed in with nothing selected', () => {
    let changes: UiSelectionChange[];

    beforeEach(() => {
      fixture.componentRef.setInput(
        'rows',
        ROWS.map(({ selected: _selected, focused: _focused, ...row }) => row),
      );
      fixture.detectChanges();
      changes = [];
      fixture.componentInstance.selectionChange.subscribe((change) => changes.push(change));
    });

    it('selects the first row, and focuses it, wherever focus landed', () => {
      rows()[2]?.focus();

      expect(changes).toEqual([{ selected: ['alpha.ts'], focused: 'alpha.ts' }]);
      expect(document.activeElement).toBe(rows()[0]);
    });

    it('leaves a selection that exists alone', () => {
      fixture.componentRef.setInput('rows', ROWS.map((row) => ({ ...row, selected: row.id === 'docs' })));
      fixture.detectChanges();

      rows()[0]?.focus();

      expect(changes).toEqual([]);
    });

    it('leaves a pointer press to select by its own rules', () => {
      rows()[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      rows()[1]?.focus();

      expect(changes).toEqual([]);
    });

    it('leaves its own moves alone: Ctrl+arrow still moves the cursor only', () => {
      rows()[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      rows()[0]?.focus();
      rows()[0]?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      rows()[0]?.dispatchEvent(keydown('ArrowDown', { ctrlKey: true }));

      expect(changes).toEqual([{ selected: [], focused: 'docs' }]);
      expect(document.activeElement).toBe(rows()[1]);
    });
  });
});

describe('UiIconView keyboard', () => {
  let fixture: ComponentFixture<UiIconView>;
  let selected: string[];
  let commands: UiPanelKey[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiIconView] }).compileComponents();
    fixture = TestBed.createComponent(UiIconView);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();

    selected = [];
    commands = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
    fixture.componentInstance.command.subscribe((key) => commands.push(key));
  });

  const tiles = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.item'));

  const press = (index: number, key: string): KeyboardEvent => {
    const event = keydown(key);
    tiles()[index]?.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  /**
   * `auto-fill` decides the column count, and jsdom lays nothing out, so the
   * tiles are given the `offsetTop`s a two-column grid would produce.
   */
  const layOutInColumns = (columns: number): void => {
    tiles().forEach((tile, index) => {
      Object.defineProperty(tile, 'offsetTop', { value: Math.floor(index / columns) * 100 });
    });
  };

  it('makes the focused tile the single tab stop', () => {
    expect(tiles().map((tile) => tile.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
  });

  it('steps one tile with the horizontal arrows and selects as it goes', () => {
    press(0, 'ArrowRight');
    expect(document.activeElement).toBe(tiles()[1]);

    press(1, 'ArrowLeft');
    expect(document.activeElement).toBe(tiles()[0]);
    expect(selected).toEqual(['docs', 'alpha.ts']);
  });

  it('steps a visual row with the vertical arrows', () => {
    layOutInColumns(2);

    press(0, 'ArrowDown');
    expect(document.activeElement).toBe(tiles()[2]);

    press(2, 'ArrowUp');
    expect(document.activeElement).toBe(tiles()[0]);
  });

  it('reports the workbench keys as panel commands, tile and all', () => {
    press(3, 'Enter');
    press(3, ' ');
    press(3, 'Backspace');
    press(3, 'Delete');

    expect(commands).toEqual([
      { command: 'open', entryId: 'notes.md' },
      { command: 'select', entryId: 'notes.md' },
      { command: 'up', entryId: 'notes.md' },
      { command: 'delete', entryId: 'notes.md' },
    ]);
  });

  /** Enter would otherwise also click the tile, selecting as well as opening. */
  it('claims Enter and Space so the button never also clicks', () => {
    expect(press(0, 'Enter').defaultPrevented).toBe(true);
    expect(press(0, ' ').defaultPrevented).toBe(true);
  });

  /** The horizontal arrows step tiles — unless `Alt` makes them the panel's. */
  it('leaves an Alt chord to the panel', () => {
    const event = keydown('ArrowLeft', { altKey: true });
    tiles()[2]?.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(selected).toEqual([]);
  });

  it('jumps to a label as it is typed', () => {
    press(0, 'z');

    expect(document.activeElement).toBe(tiles()[4]);
  });

  /** PRD 002, §3.1, as in the list. */
  it('selects the first tile when focus is handed in with nothing selected', () => {
    const changes: UiSelectionChange[] = [];
    fixture.componentRef.setInput('items', ITEMS.map(({ selected: _selected, focused: _focused, ...item }) => item));
    fixture.detectChanges();
    fixture.componentInstance.selectionChange.subscribe((change) => changes.push(change));

    tiles()[3]?.focus();

    expect(changes).toEqual([{ selected: ['alpha.ts'], focused: 'alpha.ts' }]);
    expect(document.activeElement).toBe(tiles()[0]);
  });
});

/**
 * PRD 001, §6.2.1 — the panel's own history keys. Handled by the group rather
 * than by either body view, so they work over a listing, a grid, a document
 * and an empty placeholder alike.
 */
/**
 * The keys of a panel as the workbench composes one: the `UiPanelGroup` frame
 * answers the chords about the panel itself (split, close, switch tab), and
 * the `UiFileBrowser` projected into it answers the ones about its folder.
 */
describe('panel keys', () => {
  let fixture: ComponentFixture<PanelHost>;
  let commands: UiPanelKey[];

  const GROUP: UiPanelGroupModel = {
    id: 'group-root',
    tabs: [{ id: 'tab-root', label: 'tr-file', icon: 'folder', tint: 'folder', active: true }],
    actions: [],
  };

  const BROWSER: UiFileBrowserModel = {
    breadcrumbs: [],
    view: 'list',
    toolbarActions: [],
    columns: COLUMNS,
    rows: ROWS,
    items: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PanelHost] }).compileComponents();
    fixture = TestBed.createComponent(PanelHost);
    fixture.componentRef.setInput('group', GROUP);
    fixture.componentRef.setInput('browser', BROWSER);
    fixture.detectChanges();

    commands = [];
    fixture.componentInstance.content()?.command.subscribe((key) => commands.push(key));
  });

  /** The content's body: where focus sits when it is not on a row. */
  const contentBody = (): HTMLElement => fixture.nativeElement.querySelector('.browser-body');

  /** What the content shows next, with the frame left as it is. */
  const show = (browser: Partial<UiFileBrowserModel>): void => {
    fixture.componentRef.setInput('browser', { ...BROWSER, ...browser });
    fixture.detectChanges();
  };

  const press = (key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent => {
    const event = keydown(key, modifiers);
    contentBody().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  /** PRD 001, §6.2.3 — the tree, not the trail: up one directory. */
  it('reports Alt+Up as up a directory', () => {
    expect(press('ArrowUp', { altKey: true }).defaultPrevented).toBe(true);

    expect(commands).toEqual([{ command: 'up', entryId: null }]);
  });

  /** An empty folder gives focus to the body; the chord must still answer. */
  it('reports Alt+Up from an empty body too', () => {
    show({ rows: [], empty: { icon: 'folder-open', title: 'This folder is empty' } });

    press('ArrowUp', { altKey: true });

    expect(commands).toEqual([{ command: 'up', entryId: null }]);
  });

  it('reports Alt+Left as back and Alt+Right as forward', () => {
    expect(press('ArrowLeft', { altKey: true }).defaultPrevented).toBe(true);
    expect(press('ArrowRight', { altKey: true }).defaultPrevented).toBe(true);

    expect(commands).toEqual([
      { command: 'back', entryId: null },
      { command: 'forward', entryId: null },
    ]);
  });

  it('answers from a document body too, which has no keyboard of its own', () => {
    show({ rows: [], document: { path: 'docs/README.md', kind: 'text', text: 'hello' } });

    fixture.nativeElement
      .querySelector('article.doc')
      .dispatchEvent(keydown('ArrowLeft', { altKey: true }));

    expect(commands).toEqual([{ command: 'back', entryId: null }]);
  });

  /**
   * An empty folder gives focus to the body itself, and a keyboard user has to
   * be able to walk back out of it (PRD 001, §6.2.1 with §6.3.1).
   */
  it('answers Backspace and Ctrl+R when the body itself has focus', () => {
    contentBody().dispatchEvent(keydown('Backspace'));
    contentBody().dispatchEvent(keydown('r', { ctrlKey: true }));
    fixture.detectChanges();

    expect(commands).toEqual([
      { command: 'up', entryId: null },
      { command: 'refresh', entryId: null },
    ]);
  });

  /**
   * The list owns those keys whenever there is a row to stand on. Each must
   * therefore arrive exactly once — from the list, carrying its entry — and
   * not a second time from the browser.
   */
  it('leaves Backspace to the row that has focus, and answers Ctrl+R once', () => {
    const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    row.dispatchEvent(keydown('Backspace'));
    row.dispatchEvent(keydown('r', { ctrlKey: true }));
    fixture.detectChanges();

    expect(commands).toEqual([
      { command: 'up', entryId: 'alpha.ts' },
      { command: 'refresh', entryId: null },
    ]);
  });

  /** The function keys are the window's (PRD 004, §2): a panel reports none of them. */
  it('reports no function key', () => {
    const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    for (const key of ['F2', 'F5']) {
      expect(row.dispatchEvent(keydown(key))).toBe(true);
    }
    fixture.detectChanges();

    expect(commands).toEqual([]);
  });

  /**
   * PRD 001, §6.2.2. Bound on the group rather than the body, so they answer
   * with focus anywhere in the panel — and they emit exactly what the tab
   * bar's own buttons emit, so the two paths cannot drift.
   */
  describe('Ctrl+T and Ctrl+W', () => {
    let actions: string[];
    let closed: string[];

    beforeEach(() => {
      actions = [];
      closed = [];
      fixture.componentInstance.panel().actionSelect.subscribe((id) => actions.push(id));
      fixture.componentInstance.panel().tabClose.subscribe((id) => closed.push(id));
    });

    const chord = (key: string, target: Element, modifiers: KeyboardEventInit = { ctrlKey: true }) => {
      const event = keydown(key, modifiers);
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };

    it('splits the panel on Ctrl+T', () => {
      const event = chord('t', contentBody());

      expect(actions).toEqual(['split-right']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('closes the focused tab on Ctrl+W', () => {
      const event = chord('w', contentBody());

      // GROUP's only tab is the active one.
      expect(closed).toEqual(['tab-root']);
      expect(event.defaultPrevented).toBe(true);
    });

    /** Focus may be on a tab rather than in the body; the chord still answers. */
    it('answers from the tab bar too', () => {
      chord('t', fixture.nativeElement.querySelector('.tab-main'));
      chord('w', fixture.nativeElement.querySelector('.tab-main'));

      expect(actions).toEqual(['split-right']);
      expect(closed).toEqual(['tab-root']);
    });

    /** PRD 001, §6.2.5 — open what the cursor is on, in a panel of its own. */
    describe('Ctrl+Enter', () => {
      it('reports the entry the listing is standing on', () => {
        // ROWS marks the first entry focused.
        const event = chord('Enter', contentBody());

        expect(commands).toEqual([{ command: 'open-aside', entryId: 'alpha.ts' }]);
        expect(event.defaultPrevented).toBe(true);
      });

      /** Bound on the browser, so it answers from its row as well as its body. */
      it('answers from the focused row', () => {
        chord('Enter', fixture.nativeElement.querySelector('tbody tr'));

        expect(commands).toEqual([{ command: 'open-aside', entryId: 'alpha.ts' }]);
      });

      it('falls back to the selection when nothing has the cursor', () => {
        show({
          rows: [
            { id: 'a.ts', name: 'a.ts', icon: 'file', cells: {} },
            { id: 'b.md', name: 'b.md', icon: 'file', cells: {}, selected: true },
          ],
        });

        chord('Enter', contentBody());

        expect(commands).toEqual([{ command: 'open-aside', entryId: 'b.md' }]);
      });

      /** The grid is the other body view, and the same handler serves it. */
      it('reads the grid when that is what is showing', () => {
        show({
          view: 'grid',
          rows: [],
          items: [
            { id: 'one.png', label: 'one.png', icon: 'file' },
            { id: 'two.png', label: 'two.png', icon: 'file', focused: true },
          ],
        });

        chord('Enter', contentBody());

        expect(commands).toEqual([{ command: 'open-aside', entryId: 'two.png' }]);
      });

      it('claims nothing when the body has no entries', () => {
        show({ rows: [], empty: { icon: 'folder-open', title: 'This folder is empty' } });

        const event = chord('Enter', contentBody());

        expect(commands).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
      });
    });

    /** PRD 001, §6.2.4 — switching tabs without the pointer. */
    describe('Ctrl+PageUp and Ctrl+PageDown', () => {
      const TWO_TABS: UiPanelGroupModel = {
        ...GROUP,
        tabs: [
          { id: 'tab-root', label: 'tr-file', icon: 'folder', active: true },
          { id: 'tab-docs', label: 'docs', icon: 'folder' },
        ],
      };

      let selected: string[];
      let chosen: string[];

      beforeEach(() => {
        fixture.componentRef.setInput('group', TWO_TABS);
        fixture.detectChanges();
        selected = [];
        chosen = [];
        fixture.componentInstance.panel().tabSelect.subscribe((id) => selected.push(id));
        fixture.componentInstance.panel().tabActivate.subscribe((id) => chosen.push(id));
      });

      /**
       * The same pair a click emits, so the keyboard lands focus in the new
       * tab's content just as the pointer would (§6.3).
       */
      it('moves to the next tab, as if it had been clicked', () => {
        const event = chord('PageDown', contentBody());

        expect(selected).toEqual(['tab-docs']);
        expect(chosen).toEqual(['tab-docs']);
        expect(event.defaultPrevented).toBe(true);
      });

      it('moves to the previous tab', () => {
        fixture.componentRef.setInput('group', {
          ...TWO_TABS,
          tabs: [
            { id: 'tab-root', label: 'tr-file', icon: 'folder' },
            { id: 'tab-docs', label: 'docs', icon: 'folder', active: true },
          ],
        } satisfies UiPanelGroupModel);
        fixture.detectChanges();

        chord('PageUp', contentBody());

        expect(selected).toEqual(['tab-root']);
      });

      /** Wrapping keeps the chord useful at either end of the bar. */
      it('wraps around both ends', () => {
        chord('PageUp', contentBody());

        expect(selected).toEqual(['tab-docs']);
      });

      it('answers from the tab bar too', () => {
        chord('PageDown', fixture.nativeElement.querySelector('.tab-main'));

        expect(selected).toEqual(['tab-docs']);
      });

      /** One tab is nowhere to go, so the chord is left to whatever else wants it. */
      it('claims nothing in a group with a single tab', () => {
        fixture.componentRef.setInput('group', GROUP);
        fixture.detectChanges();

        const event = chord('PageDown', contentBody());

        expect(selected).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
      });
    });

    it('has nothing to close in a group with no tabs', () => {
      fixture.componentRef.setInput('group', { ...GROUP, tabs: [] } satisfies UiPanelGroupModel);
      fixture.componentRef.setInput('browser', null);
      fixture.detectChanges();

      const event = chord('w', fixture.nativeElement.querySelector('.group-body'));

      expect(closed).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    /** A fuller chord is the OS's, and a bare letter is type-to-find. */
    it('claims neither a bare letter nor a wider chord', () => {
      chord('t', contentBody(), {});
      chord('w', contentBody(), { ctrlKey: true, shiftKey: true });
      chord('t', contentBody(), { ctrlKey: true, altKey: true });

      expect(actions).toEqual([]);
      expect(closed).toEqual([]);
    });
  });

  /** A bare arrow belongs to the rows; a fuller chord is the OS's or nobody's. */
  it('claims nothing else', () => {
    press('ArrowLeft');
    press('ArrowRight', { altKey: true, shiftKey: true });
    press('ArrowDown', { altKey: true });
    press('a', { altKey: true });

    expect(commands).toEqual([]);
  });
});
