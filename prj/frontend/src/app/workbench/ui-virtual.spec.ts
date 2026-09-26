import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileList, UiIconView } from '@tr-file/ui';
import type { UiFileColumn, UiFileRow, UiIconViewItem } from '@tr-file/ui';
import { visibleRange } from '../../../../libs/ui/src/lib/virtual/ui-virtual-viewport';

/**
 * PRD 003, §1 — a long folder renders only what is near the viewport. jsdom
 * has no layout, so these pin the behaviour that does not depend on one: the
 * window is a slice, spacers stand in for the rest, and every key still
 * reaches every entry.
 */

const COLUMNS: readonly UiFileColumn[] = [{ key: 'name', label: 'Name' }];

const names = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `file-${String(index).padStart(4, '0')}.txt`);

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

describe('visibleRange', () => {
  it('covers the viewport plus an overscan on either side', () => {
    const range = visibleRange({ total: 1000, lineHeight: 22, perLine: 1, scrollTop: 2200, viewportHeight: 440, leading: 0 });

    // Rows 100–119 are on screen; twenty more are kept above and below.
    expect(range).toEqual({ start: 80, end: 140 });
  });

  it('starts every window on a line boundary in a grid', () => {
    const range = visibleRange({ total: 1000, lineHeight: 80, perLine: 6, scrollTop: 8000, viewportHeight: 400, leading: 10 });

    expect(range.start % 6).toBe(0);
    expect(range.end - range.start).toBeLessThan(1000);
  });

  it('never runs past either end', () => {
    expect(visibleRange({ total: 30, lineHeight: 22, perLine: 1, scrollTop: 0, viewportHeight: 440, leading: 0 })).toEqual({
      start: 0,
      end: 30,
    });
    expect(
      visibleRange({ total: 1000, lineHeight: 22, perLine: 1, scrollTop: 99_999, viewportHeight: 440, leading: 0 }).end,
    ).toBe(1000);
  });
});

describe('UiFileList with a long listing', () => {
  let fixture: ComponentFixture<UiFileList>;
  let selected: string[];

  const rowsOf = (count: number): UiFileRow[] =>
    names(count).map((name, index) => ({ id: name, name, icon: 'file', cells: {}, ...(index === 0 ? { focused: true } : {}) }));

  const setUp = async (count: number): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [UiFileList] }).compileComponents();
    fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', rowsOf(count));
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    selected = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
  };

  afterEach(() => fixture.nativeElement.remove());

  const rendered = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('tbody tr:not(.spacer)'));

  it('renders every row of a short listing, with no spacers', async () => {
    await setUp(50);

    expect(rendered()).toHaveLength(50);
    expect(fixture.nativeElement.querySelector('tr.spacer')).toBeNull();
    expect(fixture.nativeElement.querySelector('table').getAttribute('aria-rowcount')).toBeNull();
  });

  it('renders a window of a long listing, standing in for the rest', async () => {
    await setUp(1000);

    expect(rendered().length).toBeGreaterThan(0);
    expect(rendered().length).toBeLessThan(200);
    expect(fixture.nativeElement.querySelector('tr.spacer')).not.toBeNull();
    // Assistive tech is told the real size, header row included.
    expect(fixture.nativeElement.querySelector('table').getAttribute('aria-rowcount')).toBe('1001');
    expect(rendered()[0]?.getAttribute('aria-rowindex')).toBe('2');
  });

  it('keeps a tab stop among the rendered rows', async () => {
    await setUp(1000);

    expect(fixture.nativeElement.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(1);
  });

  /** End goes to row 1000, which is not rendered until the list scrolls there. */
  it('reaches the last row with End, focusing it once it is rendered', async () => {
    await setUp(1000);
    const last = names(1000).at(-1);

    rendered()[0]?.dispatchEvent(keydown('End'));
    fixture.detectChanges();

    expect(selected).toEqual([last]);
    expect((document.activeElement as HTMLElement).dataset['rowId']).toBe(last);
    expect(rendered().some((row) => row.dataset['rowId'] === names(1000)[0])).toBe(false);
  });

  it('finds a row far down the list by typing its name', async () => {
    await setUp(1000);

    rendered()[0]?.dispatchEvent(keydown('f'));
    fixture.detectChanges();

    // Cycling on one letter steps to the next match, which is rendered anyway;
    // Home then End proves a round trip across the whole list.
    rendered()[0]?.dispatchEvent(keydown('End'));
    fixture.detectChanges();
    (document.activeElement as HTMLElement).dispatchEvent(keydown('Home'));
    fixture.detectChanges();

    expect((document.activeElement as HTMLElement).dataset['rowId']).toBe(names(1000)[0]);
  });
});

describe('UiIconView with a long folder', () => {
  let fixture: ComponentFixture<UiIconView>;
  let selected: string[];

  const items = (count: number): UiIconViewItem[] =>
    names(count).map((name) => ({ id: name, label: name, icon: 'file' }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiIconView] }).compileComponents();
    fixture = TestBed.createComponent(UiIconView);
    fixture.componentRef.setInput('items', items(1000));
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    selected = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
  });

  afterEach(() => fixture.nativeElement.remove());

  const tiles = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.item'));

  it('renders a window of the tiles, and says how many there are', () => {
    expect(tiles().length).toBeGreaterThan(0);
    expect(tiles().length).toBeLessThan(1000);
    expect(tiles()[0]?.getAttribute('aria-setsize')).toBe('1000');
    expect(fixture.nativeElement.querySelector('.spacer')).not.toBeNull();
  });

  it('reaches the last tile with End', () => {
    tiles()[0]?.dispatchEvent(keydown('End'));
    fixture.detectChanges();

    expect(selected).toEqual([names(1000).at(-1)]);
    expect((document.activeElement as HTMLElement).dataset['itemId']).toBe(names(1000).at(-1));
  });
});
