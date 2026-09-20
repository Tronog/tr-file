import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileList, UiIconView } from '@tr-file/ui';
import type { UiFileColumn, UiFileRow, UiIconViewItem, UiPanelKey } from '@tr-file/ui';

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
function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
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

  it('jumps to a label as it is typed', () => {
    press(0, 'z');

    expect(document.activeElement).toBe(tiles()[4]);
  });
});
