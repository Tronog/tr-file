import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileList, UiIconView, UiPanelGroup } from '@tr-file/ui';
import type {
  UiFileColumn,
  UiFileRow,
  UiIconViewItem,
  UiPanelGroupModel,
  UiPanelKey,
} from '@tr-file/ui';

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
  it('reports Enter, Space, Backspace and F5 as panel commands', () => {
    press(2, 'Enter');
    press(2, ' ');
    press(2, 'Backspace');
    press(2, 'F5');

    expect(commands).toEqual([
      { command: 'open', entryId: 'download.zip' },
      { command: 'select', entryId: 'download.zip' },
      { command: 'up', entryId: 'download.zip' },
      { command: 'refresh', entryId: 'download.zip' },
    ]);
    // None of them moved the selection on their own.
    expect(selected).toEqual([]);
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

    const modified = new KeyboardEvent('keydown', {
      key: 'a',
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

  it('travels a page at a time with PageDown and PageUp', () => {
    // jsdom measures nothing, so the fallback page of ten overshoots the list
    // and clamps — which is the behaviour a short listing should have anyway.
    press(0, 'PageDown');
    expect(document.activeElement).toBe(rows()[4]);

    press(4, 'PageUp');
    expect(document.activeElement).toBe(rows()[0]);
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

    expect(commands).toEqual([
      { command: 'open', entryId: 'notes.md' },
      { command: 'select', entryId: 'notes.md' },
      { command: 'up', entryId: 'notes.md' },
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
});

/**
 * PRD 001, §6.2.1 — the panel's own history keys. Handled by the group rather
 * than by either body view, so they work over a listing, a grid, a document
 * and an empty placeholder alike.
 */
describe('UiPanelGroup panel keys', () => {
  let fixture: ComponentFixture<UiPanelGroup>;
  let commands: UiPanelKey[];

  const GROUP: UiPanelGroupModel = {
    id: 'group-root',
    tabs: [{ id: 'tab-root', label: 'tr-file', icon: 'folder', tint: 'folder', active: true }],
    actions: [],
    breadcrumbs: [],
    view: 'list',
    toolbarActions: [],
    columns: COLUMNS,
    rows: ROWS,
    items: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiPanelGroup] }).compileComponents();
    fixture = TestBed.createComponent(UiPanelGroup);
    fixture.componentRef.setInput('group', GROUP);
    fixture.detectChanges();

    commands = [];
    fixture.componentInstance.command.subscribe((key) => commands.push(key));
  });

  const press = (key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent => {
    const event = keydown(key, modifiers);
    fixture.nativeElement.querySelector('.group-body').dispatchEvent(event);
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
    fixture.componentRef.setInput('group', {
      ...GROUP,
      rows: [],
      empty: { icon: 'folder-open', title: 'This folder is empty' },
    } satisfies UiPanelGroupModel);
    fixture.detectChanges();

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
    fixture.componentRef.setInput('group', {
      ...GROUP,
      rows: [],
      document: { path: 'docs/README.md', kind: 'text', text: 'hello' },
    } satisfies UiPanelGroupModel);
    fixture.detectChanges();

    press('ArrowLeft', { altKey: true });

    expect(commands).toEqual([{ command: 'back', entryId: null }]);
  });

  /**
   * An empty folder gives focus to the body itself, and a keyboard user has to
   * be able to walk back out of it (PRD 001, §6.2.1 with §6.3.1).
   */
  it('answers Backspace and F5 when the body itself has focus', () => {
    const body = fixture.nativeElement.querySelector('.group-body') as HTMLElement;
    body.dispatchEvent(keydown('Backspace'));
    body.dispatchEvent(keydown('F5'));
    fixture.detectChanges();

    expect(commands).toEqual([
      { command: 'up', entryId: null },
      { command: 'refresh', entryId: null },
    ]);
  });

  /**
   * The list owns those keys whenever there is a row to stand on. Each must
   * therefore arrive exactly once — from the list, carrying its entry — and
   * not a second time from the group.
   */
  it('leaves Backspace and F5 to the row that has focus', () => {
    const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    row.dispatchEvent(keydown('Backspace'));
    row.dispatchEvent(keydown('F5'));
    fixture.detectChanges();

    expect(commands).toEqual([
      { command: 'up', entryId: 'alpha.ts' },
      { command: 'refresh', entryId: 'alpha.ts' },
    ]);
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
      fixture.componentInstance.actionSelect.subscribe((id) => actions.push(id));
      fixture.componentInstance.tabClose.subscribe((id) => closed.push(id));
    });

    const chord = (key: string, target: Element, modifiers: KeyboardEventInit = { ctrlKey: true }) => {
      const event = keydown(key, modifiers);
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };

    it('splits the panel on Ctrl+T', () => {
      const event = chord('t', fixture.nativeElement.querySelector('.group-body'));

      expect(actions).toEqual(['split-right']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('closes the focused tab on Ctrl+W', () => {
      const event = chord('w', fixture.nativeElement.querySelector('.group-body'));

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

    it('has nothing to close in a group with no tabs', () => {
      fixture.componentRef.setInput('group', { ...GROUP, tabs: [], rows: [] } satisfies UiPanelGroupModel);
      fixture.detectChanges();

      const event = chord('w', fixture.nativeElement.querySelector('.group-body'));

      expect(closed).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    /** A fuller chord is the OS's, and a bare letter is type-to-find. */
    it('claims neither a bare letter nor a wider chord', () => {
      chord('t', fixture.nativeElement.querySelector('.group-body'), {});
      chord('w', fixture.nativeElement.querySelector('.group-body'), { ctrlKey: true, shiftKey: true });
      chord('t', fixture.nativeElement.querySelector('.group-body'), { ctrlKey: true, altKey: true });

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
