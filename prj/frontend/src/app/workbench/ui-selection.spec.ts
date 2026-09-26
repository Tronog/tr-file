import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileList, UiIconView } from '@tr-file/ui';
import type { UiFileColumn, UiFileRow, UiIconViewItem, UiSelectionChange } from '@tr-file/ui';
import { UiListSelection } from '../../../../libs/ui/src/lib/keyboard/list-selection';

/**
 * PRD 004, §1.2 — every view selects many: `Shift` for a range, `Ctrl` to
 * toggle, and a box in the icon view.
 */

const IDS = ['a', 'b', 'c', 'd', 'e'] as const;
const COLUMNS: readonly UiFileColumn[] = [{ key: 'name', label: 'Name' }];

function keydown(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}

function click(target: Element, modifiers: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
}

describe('UiListSelection', () => {
  const pick = (
    selection: UiListSelection,
    target: string,
    mode: Parameters<UiListSelection['pick']>[0]['mode'],
    selected: readonly string[] = [],
    cursor: string | null = null,
  ): UiSelectionChange => selection.pick({ ids: IDS, selected: new Set(selected), cursor, target, mode });

  it('replaces the selection and sets the anchor', () => {
    expect(pick(new UiListSelection(), 'c', 'replace', ['a', 'b'])).toEqual({ selected: ['c'], focused: 'c' });
  });

  it('toggles one entry, keeping the rest, in list order', () => {
    const selection = new UiListSelection();

    expect(pick(selection, 'a', 'toggle', ['d'])).toEqual({ selected: ['a', 'd'], focused: 'a' });
    expect(pick(selection, 'd', 'toggle', ['a', 'd'])).toEqual({ selected: ['a'], focused: 'd' });
  });

  it('selects the range from the anchor, in either direction', () => {
    const selection = new UiListSelection();
    pick(selection, 'b', 'replace');

    expect(pick(selection, 'd', 'range', ['b'])).toEqual({ selected: ['b', 'c', 'd'], focused: 'd' });
    // The anchor stays put, so a second range is from it again, not from `d`.
    expect(pick(selection, 'a', 'range', ['b', 'c', 'd'])).toEqual({ selected: ['a', 'b'], focused: 'a' });
  });

  it('adds a range to what is selected with range-add', () => {
    const selection = new UiListSelection();
    pick(selection, 'd', 'toggle', ['a']);

    expect(pick(selection, 'e', 'range-add', ['a', 'd'])).toEqual({ selected: ['a', 'd', 'e'], focused: 'e' });
  });

  it('starts a range from the cursor when there is no anchor yet', () => {
    expect(pick(new UiListSelection(), 'd', 'range', ['b'], 'b')).toEqual({ selected: ['b', 'c', 'd'], focused: 'd' });
  });

  it('moves the cursor alone in focus mode, and selects all in all mode', () => {
    expect(pick(new UiListSelection(), 'e', 'focus', ['b', 'a'])).toEqual({ selected: ['a', 'b'], focused: 'e' });
    expect(pick(new UiListSelection(), 'c', 'all', [], 'c')).toEqual({ selected: [...IDS], focused: 'c' });
  });
});

describe('UiFileList selecting many', () => {
  let fixture: ComponentFixture<UiFileList>;
  let changes: UiSelectionChange[];

  /** Renders `selected` as the application would after each change. */
  const render = (selected: readonly string[], focused: string): void => {
    const rows: UiFileRow[] = IDS.map((id) => ({
      id,
      name: id,
      icon: 'file',
      cells: {},
      ...(selected.includes(id) ? { selected: true } : {}),
      ...(id === focused ? { focused: true } : {}),
    }));
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
  };

  /** Feeds every change back in, the way the workbench does. */
  const follow = (): void => {
    fixture.componentInstance.selectionChange.subscribe((change) => {
      changes.push(change);
      render(change.selected, change.focused ?? 'a');
    });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileList] }).compileComponents();
    fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', COLUMNS);
    document.body.appendChild(fixture.nativeElement);
    changes = [];
    render([], 'a');
    follow();
  });

  afterEach(() => fixture.nativeElement.remove());

  const row = (id: string): HTMLElement => fixture.nativeElement.querySelector(`tr[data-row-id="${id}"]`);
  const last = (): UiSelectionChange | undefined => changes.at(-1);

  it('selects one row with a plain click', () => {
    click(row('c'));

    expect(last()).toEqual({ selected: ['c'], focused: 'c' });
  });

  it('toggles rows in and out with Ctrl-click, and ⌘-click on a Mac', () => {
    click(row('b'));
    click(row('d'), { ctrlKey: true });
    click(row('e'), { metaKey: true });
    click(row('b'), { ctrlKey: true });

    expect(last()).toEqual({ selected: ['d', 'e'], focused: 'b' });
  });

  it('selects from the anchor to the row with Shift-click', () => {
    click(row('b'));
    click(row('d'), { shiftKey: true });

    expect(last()).toEqual({ selected: ['b', 'c', 'd'], focused: 'd' });
    expect(fixture.nativeElement.querySelectorAll('tr.is-selected')).toHaveLength(3);
  });

  it('extends the selection with Shift and the arrows', () => {
    click(row('b'));
    row('b').dispatchEvent(keydown('ArrowDown', { shiftKey: true }));
    row('c').dispatchEvent(keydown('ArrowDown', { shiftKey: true }));

    expect(last()).toEqual({ selected: ['b', 'c', 'd'], focused: 'd' });
    expect(document.activeElement).toBe(row('d'));
  });

  it('extends to the end with Shift+End', () => {
    click(row('c'));
    row('c').dispatchEvent(keydown('End', { shiftKey: true }));

    expect(last()?.selected).toEqual(['c', 'd', 'e']);
  });

  it('moves the cursor alone with Ctrl and the arrows, and toggles with Ctrl+Space', () => {
    click(row('a'));
    row('a').dispatchEvent(keydown('ArrowDown', { ctrlKey: true }));
    row('b').dispatchEvent(keydown('ArrowDown', { ctrlKey: true }));
    expect(last()).toEqual({ selected: ['a'], focused: 'c' });

    const toggle = keydown(' ', { ctrlKey: true });
    row('c').dispatchEvent(toggle);

    expect(toggle.defaultPrevented).toBe(true);
    expect(last()).toEqual({ selected: ['a', 'c'], focused: 'c' });
  });

  it('selects everything with Ctrl+A', () => {
    click(row('b'));
    row('b').dispatchEvent(keydown('a', { ctrlKey: true }));

    expect(last()).toEqual({ selected: [...IDS], focused: 'b' });
  });

  /** Those are the panel's: switching tabs, opening aside. */
  it('leaves Ctrl+PageDown and Ctrl+Enter to the panel', () => {
    const page = keydown('PageDown', { ctrlKey: true });
    const aside = keydown('Enter', { ctrlKey: true });
    row('a').dispatchEvent(page);
    row('a').dispatchEvent(aside);

    expect(page.defaultPrevented).toBe(false);
    expect(aside.defaultPrevented).toBe(false);
    expect(changes).toEqual([]);
  });
});

describe('UiIconView selecting many', () => {
  let fixture: ComponentFixture<UiIconView>;
  let changes: UiSelectionChange[];

  const COLUMNS_PER_ROW = 3;
  const TILE = 90;
  const STRIDE = 100;

  const render = (selected: readonly string[], focused: string | null): void => {
    const items: UiIconViewItem[] = IDS.map((id) => ({
      id,
      label: id,
      icon: 'file',
      ...(selected.includes(id) ? { selected: true } : {}),
      ...(id === focused ? { focused: true } : {}),
    }));
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    layOut();
  };

  /**
   * jsdom has no layout, so the grid is described to the component the way a
   * browser would: three 90px tiles to a row, 100px apart, 10px in from the
   * host's corner — tiles a, b, c on the first row, d and e on the second.
   */
  const layOut = (): void => {
    const host = fixture.nativeElement as HTMLElement;
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    host.querySelectorAll<HTMLElement>('.item').forEach((tile, index) => {
      const define = (name: string, value: number) => Object.defineProperty(tile, name, { value, configurable: true });
      define('offsetLeft', 10 + (index % COLUMNS_PER_ROW) * STRIDE);
      define('offsetTop', 10 + Math.floor(index / COLUMNS_PER_ROW) * STRIDE);
      define('offsetWidth', TILE);
      define('offsetHeight', TILE);
    });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiIconView] }).compileComponents();
    fixture = TestBed.createComponent(UiIconView);
    document.body.appendChild(fixture.nativeElement);
    changes = [];
    render([], null);
    fixture.componentInstance.selectionChange.subscribe((change) => {
      changes.push(change);
      render(change.selected, change.focused);
    });
  });

  afterEach(() => fixture.nativeElement.remove());

  const tile = (id: string): HTMLElement => fixture.nativeElement.querySelector(`[data-item-id="${id}"]`);
  const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}): void => {
    const target = type === 'pointerdown' ? fixture.nativeElement : fixture.nativeElement;
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, ...init }));
    fixture.detectChanges();
  };

  it('says it selects many', () => {
    expect(fixture.nativeElement.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('toggles with Ctrl-click and ranges with Shift-click, as the list does', () => {
    click(tile('a'));
    click(tile('c'), { ctrlKey: true });
    expect(changes.at(-1)).toEqual({ selected: ['a', 'c'], focused: 'c' });

    click(tile('e'), { shiftKey: true });
    expect(changes.at(-1)).toEqual({ selected: ['c', 'd', 'e'], focused: 'e' });
  });

  it('extends a row down with Shift and the arrows', () => {
    click(tile('a'));
    tile('a').dispatchEvent(keydown('ArrowDown', { shiftKey: true }));

    // Down one visual row is a → d: everything between is in the range.
    expect(changes.at(-1)?.selected).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selects every tile a dragged box touches', () => {
    // From blank space right of `c`, down and left across `b`, `c` and `e`.
    pointer('pointerdown', 395, 5);
    pointer('pointermove', 395, 150);
    pointer('pointermove', 150, 150);

    expect(changes.at(-1)?.selected).toEqual(['b', 'c', 'e']);
    expect(fixture.nativeElement.querySelector('.marquee')).not.toBeNull();

    pointer('pointerup', 150, 150);
    expect(fixture.nativeElement.querySelector('.marquee')).toBeNull();
  });

  it('adds the box to the selection when Ctrl is held', () => {
    click(tile('a'));
    pointer('pointerdown', 395, 5, { ctrlKey: true });
    pointer('pointermove', 250, 50, { ctrlKey: true });

    expect(changes.at(-1)?.selected).toEqual(['a', 'c']);
  });

  it('treats a press that barely moves as a click, which clears the selection', () => {
    click(tile('b'));
    pointer('pointerdown', 395, 395);
    pointer('pointermove', 396, 396);
    pointer('pointerup', 396, 396);

    expect(changes.at(-1)).toEqual({ selected: [], focused: null });
    expect(fixture.nativeElement.querySelector('.marquee')).toBeNull();
  });

  it('starts no box from a press on a tile', () => {
    tile('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }));
    pointer('pointermove', 300, 200);

    expect(fixture.nativeElement.querySelector('.marquee')).toBeNull();
  });
});
