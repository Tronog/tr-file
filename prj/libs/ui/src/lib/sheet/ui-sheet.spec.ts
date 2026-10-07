import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UiSheet } from '../../public-api';

/** PRD 015, §1 — a spreadsheet: select cells, rows and columns, walk it with the arrows, copy and paste, edit. */
describe('UiSheet', () => {
  let fixture: ComponentFixture<UiSheet>;
  let changes: (readonly (readonly string[])[])[];
  let where: string[];

  const ROWS = [
    ['name', 'qty', 'price'],
    ['apple', '3', '1.5'],
    ['pear', '', '2'],
    ['plum', '7', ''],
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSheet] }).compileComponents();
    fixture = TestBed.createComponent(UiSheet);
    fixture.componentRef.setInput('rows', ROWS);
    changes = [];
    where = [];
    fixture.componentInstance.rowsChange.subscribe((rows) => changes.push(rows));
    fixture.componentInstance.selectionChange.subscribe((name) => where.push(name));
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  const grid = (): HTMLElement => fixture.nativeElement.querySelector('[role="grid"]') as HTMLElement;
  const press = (key: string, init: KeyboardEventInit = {}, target: Element = grid()): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  const cell = (row: number, column: number): HTMLElement =>
    fixture.nativeElement.querySelectorAll('tbody tr:not(.spacer)')[row].querySelectorAll('td')[column] as HTMLElement;
  const pointer = (target: Element, type: string, init: PointerEventInit = {}): void => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init }));
    fixture.detectChanges();
  };
  /** A copy, cut or paste event, as the browser sends one, with a clipboard of its own. */
  const clipboard = (type: 'copy' | 'cut' | 'paste', text = ''): { data: Record<string, string>; event: Event } => {
    const data: Record<string, string> = { 'text/plain': text };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (format: string) => data[format] ?? '', setData: (format: string, value: string) => (data[format] = value) },
    });
    grid().focus();
    document.dispatchEvent(event);
    fixture.detectChanges();
    return { data, event };
  };
  const last = (): string => where.at(-1) ?? '';

  it('draws the cells under column letters and row numbers, the first cell active', () => {
    expect(Array.from(fixture.nativeElement.querySelectorAll('.column-head')).map((head) => (head as HTMLElement).textContent?.trim())).toEqual(['A', 'B', 'C']);
    expect(cell(1, 0).textContent?.trim()).toBe('apple');
    expect(cell(0, 0).classList).toContain('is-active');
    expect(grid().getAttribute('aria-activedescendant')).toBe(cell(0, 0).id);
  });

  it('walks with the arrows, extends with Shift, and jumps to the edge of the data with Ctrl', () => {
    press('ArrowDown');
    press('ArrowRight');
    expect(last()).toBe('B2');
    press('ArrowDown', { shiftKey: true });
    press('ArrowRight', { shiftKey: true });
    expect(last()).toBe('B2:C3');
    press('ArrowDown', { ctrlKey: true });
    expect(last()).toBe('B4');
    press('Home', { ctrlKey: true });
    press('End', { ctrlKey: true });
    expect(last()).toBe('C4');
  });

  it('leaves Alt chords and Ctrl+PageUp / PageDown to the panel', () => {
    expect(press('ArrowUp', { altKey: true }).defaultPrevented).toBe(false);
    expect(press('PageDown', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('PageDown').defaultPrevented).toBe(true);
  });

  it('selects a range by dragging, a column by its letter and a row by its number', () => {
    pointer(cell(1, 0), 'pointerdown');
    pointer(cell(2, 1), 'pointerenter');
    expect(last()).toBe('A2:B3');

    pointer(fixture.nativeElement.querySelectorAll('.column-head')[1], 'pointerdown');
    expect(last()).toBe('B1:B4');
    pointer(fixture.nativeElement.querySelectorAll('.row-head')[2], 'pointerdown');
    expect(last()).toBe('A3:C3');
    expect(fixture.nativeElement.querySelectorAll('.row-head.is-whole').length).toBe(1);
  });

  it('copies the selection as a spreadsheet does, tab-separated', () => {
    press('ArrowDown');
    press('ArrowDown', { shiftKey: true });
    press('ArrowRight', { shiftKey: true });
    const { data, event } = clipboard('copy');
    expect(data['text/plain']).toBe('apple\t3\npear\t');
    expect(event.defaultPrevented).toBe(true);
  });

  it('changes nothing while it is only viewed', () => {
    press('x');
    press('Delete');
    clipboard('paste', 'z');
    expect(changes).toEqual([]);
    expect(fixture.nativeElement.querySelector('.cell-input')).toBeNull();
  });

  describe('editable', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('editable', true);
      fixture.detectChanges();
    });

    it('shows a row and a column more, to grow into', () => {
      expect(fixture.nativeElement.querySelectorAll('.column-head').length).toBe(4);
      expect(fixture.nativeElement.querySelectorAll('.row-head').length).toBe(5);
    });

    it('replaces a cell by typing into it, and moves down on Enter', () => {
      press('ArrowDown');
      press('b');
      const input = fixture.nativeElement.querySelector('.cell-input') as HTMLInputElement;
      expect(input.value).toBe('b');
      input.value = 'banana';
      input.dispatchEvent(new Event('input'));
      press('Enter', {}, input);

      expect(changes.at(-1)?.[1]).toEqual(['banana', '3', '1.5']);
      expect(last()).toBe('A3');
      expect(document.activeElement).toBe(grid());
    });

    it('edits in place on F2, drops the edit on Escape, and grows the table past its end', () => {
      press('F2');
      const input = fixture.nativeElement.querySelector('.cell-input') as HTMLInputElement;
      expect(input.value).toBe('name');
      press('Escape', {}, input);
      expect(changes).toEqual([]);

      press('End', { ctrlKey: true });
      press('ArrowRight');
      press('n');
      press('Enter', {}, fixture.nativeElement.querySelector('.cell-input') as HTMLInputElement);
      expect(changes.at(-1)).toEqual([
        ['name', 'qty', 'price', ''],
        ['apple', '3', '1.5', ''],
        ['pear', '', '2', ''],
        ['plum', '7', '', 'n'],
      ]);
    });

    it('puts a typed value in before a window key — Save, Edit — goes on', () => {
      press('q');
      const input = fixture.nativeElement.querySelector('.cell-input') as HTMLInputElement;
      input.value = 'quince';
      input.dispatchEvent(new Event('input'));
      const save = press('s', { ctrlKey: true }, input);

      expect(save.defaultPrevented).toBe(false);
      expect(changes.at(-1)?.[0]).toEqual(['quince', 'qty', 'price']);
    });

    it('empties the selection on Delete, and undoes and redoes it', () => {
      press('ArrowDown');
      press('ArrowRight', { shiftKey: true });
      press('Delete');
      expect(changes.at(-1)?.[1]).toEqual(['', '', '1.5']);
      press('z', { ctrlKey: true });
      expect(changes.at(-1)?.[1]).toEqual(['apple', '3', '1.5']);
      press('y', { ctrlKey: true });
      expect(changes.at(-1)?.[1]).toEqual(['', '', '1.5']);
    });

    it('pastes a block from the active cell, and fills a selection with one value', () => {
      press('ArrowDown');
      press('ArrowRight');
      clipboard('paste', 'x\ty\r\nz\tw\r\n');
      expect(changes.at(-1)?.slice(1, 3)).toEqual([
        ['apple', 'x', 'y'],
        ['pear', 'z', 'w'],
      ]);
      expect(last()).toBe('B2:C3');

      clipboard('paste', '0');
      expect(changes.at(-1)?.slice(1, 3)).toEqual([
        ['apple', '0', '0'],
        ['pear', '0', '0'],
      ]);
    });

    it('cuts: copies, then empties', () => {
      press('ArrowDown');
      const { data } = clipboard('cut');
      expect(data['text/plain']).toBe('apple');
      expect(changes.at(-1)?.[1]).toEqual(['', '3', '1.5']);
    });
  });

  /** PRD 015, §2.1. */
  describe('search', () => {
    const field = (): HTMLInputElement => fixture.nativeElement.querySelector('.find input') as HTMLInputElement;
    const count = (): string => (fixture.nativeElement.querySelector('.find-count') as HTMLElement).textContent?.trim() ?? '';
    const query = (text: string): void => {
      field().value = text;
      field().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const inField = (key: string, shiftKey = false): void => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };

    it('opens on Ctrl+F with the active cell as its query, and marks every cell holding it, case ignored', () => {
      press('ArrowDown');
      expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(field().value).toBe('apple');
      expect(count()).toBe('1 found');

      query('P');
      expect(count()).toBe('4 found');
      expect(Array.from(fixture.nativeElement.querySelectorAll('td.is-match')).map((td) => (td as HTMLElement).textContent?.trim())).toEqual([
        'price',
        'apple',
        'pear',
        'plum',
      ]);
      expect(fixture.nativeElement.querySelector('td.is-match mark')?.textContent).toBe('p');
    });

    it('takes the active cell to the next and previous match, row by row, from where it is, round at the ends', () => {
      press('f', { ctrlKey: true });
      query('p');
      inField('Enter');
      // From A1: the next match past it is C1 ("price").
      expect(last()).toBe('C1');
      expect(count()).toBe('1 of 4');
      inField('Enter');
      inField('Enter');
      inField('Enter');
      expect(last()).toBe('A4');
      inField('Enter');
      expect(last()).toBe('C1');
      inField('Enter', true);
      expect(last()).toBe('A4');
    });

    it('steps with F3 on the sheet, and closes on Escape, the sheet keeping the keyboard', () => {
      press('f', { ctrlKey: true });
      query('plum');
      inField('Escape');
      expect(fixture.nativeElement.querySelector('.find')).toBeNull();
      expect(document.activeElement).toBe(grid());
      expect(fixture.nativeElement.querySelector('td.is-match')).toBeNull();

      press('f', { ctrlKey: true });
      query('pear');
      grid().focus();
      press('F3');
      expect(last()).toBe('A3');
      expect(press('Escape').defaultPrevented).toBe(true);
      expect(fixture.nativeElement.querySelector('.find')).toBeNull();
    });

    it('says when nothing matches', () => {
      press('f', { ctrlKey: true });
      query('zzz');
      expect(count()).toBe('No results');
      inField('Enter');
      expect(last()).toBe('A1');
    });
  });
});
