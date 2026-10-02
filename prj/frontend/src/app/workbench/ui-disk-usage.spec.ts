import { TestBed } from '@angular/core/testing';
import { squarify, sunburst, tableRows, treemap, UiDiskUsage, type UiDiskUsageItem, type UiDiskUsageModel } from '@tr-file/ui';

/** PRD 013, §2.1 — what takes up the space in a folder, drawn three ways. */

const file = (id: string, size: number): UiDiskUsageItem => ({ id, name: id.split('/').at(-1) ?? id, kind: 'file', size, sizeLabel: `${size} B` });

const root: UiDiskUsageItem = {
  id: 'docs',
  name: 'docs',
  kind: 'folder',
  size: 100,
  sizeLabel: '100 B',
  openable: true,
  children: [
    {
      id: 'docs/big',
      name: 'big',
      kind: 'folder',
      size: 60,
      sizeLabel: '60 B',
      openable: true,
      detail: '2 files · 0 folders',
      children: [file('docs/big/a', 40), file('docs/big/b', 20)],
    },
    file('docs/c.txt', 30),
    { id: 'docs\u0000rest', name: '3 more', kind: 'rest', size: 10, sizeLabel: '10 B' },
  ],
};

describe('disk usage layout', () => {
  it('lists the table\'s rows depth first, each a share of the folder, coloured by its top-level entry', () => {
    expect(tableRows(root, 2).map((row) => [row.item.name, row.level, row.percent, row.hue])).toEqual([
      ['big', 0, 60, 'blue'],
      ['a', 1, 40, 'blue'],
      ['b', 1, 20, 'blue'],
      ['c.txt', 0, 30, 'green'],
      ['3 more', 0, 10, 'rest'],
    ]);
    expect(tableRows(root, 1)).toHaveLength(3);
  });

  it('rings the pie a level at a time, each folder\'s entries within its angle', () => {
    const slices = sunburst(root, 2);
    expect(slices.map((slice) => [slice.item.name, slice.level])).toEqual([
      ['big', 1],
      ['a', 2],
      ['b', 2],
      ['c.txt', 1],
      ['3 more', 1],
    ]);
    expect(slices.every((slice) => slice.d.startsWith('M') && slice.d.endsWith('Z'))).toBe(true);
    // One entry that is everything is a whole ring, drawn as two halves.
    const whole = sunburst({ ...root, children: [file('docs/all', 100)] }, 1);
    expect(whole[0]?.d.match(/M/g)).toHaveLength(2);
    expect(sunburst({ ...root, size: 0 }, 2)).toEqual([]);
  });

  it('lays rectangles out with areas in proportion to the sizes, inside the room they have', () => {
    const placed = squarify(root.children ?? [], { x: 0, y: 0, width: 200, height: 100 });
    const area = (name: string) => {
      const rect = placed.find((entry) => entry.item.name === name)?.rect;
      return rect === undefined ? 0 : rect.width * rect.height;
    };
    expect(area('big')).toBeCloseTo(12000);
    expect(area('c.txt')).toBeCloseTo(6000);
    expect(area('3 more')).toBeCloseTo(2000);
    for (const { rect } of placed) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(200.0001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(100.0001);
    }
  });

  it('nests a folder\'s entries in its rectangle, under its name where there is room', () => {
    const cells = treemap(root, 2, 400, 300);
    const big = cells.find((cell) => cell.item.name === 'big');
    expect(big?.header).toBe(true);
    const inside = cells.filter((cell) => cell.level === 2);
    expect(inside.map((cell) => cell.item.name)).toEqual(['a', 'b']);
    for (const cell of inside) {
      expect(cell.x).toBeGreaterThanOrEqual(big?.x ?? 0);
      expect(cell.y).toBeGreaterThan(big?.y ?? 0);
      expect(cell.x + cell.width).toBeLessThanOrEqual((big?.x ?? 0) + (big?.width ?? 0));
    }
    expect(treemap(root, 1, 400, 300).some((cell) => cell.level === 2)).toBe(false);
  });
});

describe('UiDiskUsage', () => {
  const model = (overrides: Partial<UiDiskUsageModel> = {}): UiDiskUsageModel => ({
    breadcrumbs: [
      { id: 'root', label: 'files', icon: 'desktop' },
      { id: 'docs', label: 'docs' },
    ],
    location: '/docs',
    toolbarActions: [
      { id: 'up', label: 'Up one level', icon: 'arrow-up' },
      { id: 'refresh', label: 'Scan again', icon: 'refresh' },
    ],
    view: 'table',
    depth: 2,
    maxDepth: 8,
    summary: '3 files · 100 B',
    root,
    ...overrides,
  });

  const setUp = (value = model()) => {
    const fixture = TestBed.createComponent(UiDiskUsage);
    fixture.componentRef.setInput('model', value);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const events: string[] = [];
    const ui = fixture.componentInstance;
    ui.open.subscribe((id) => events.push(`open ${id}`));
    ui.toolbarAction.subscribe((id) => events.push(`action ${id}`));
    ui.viewChange.subscribe((view) => events.push(`view ${view}`));
    ui.depthChange.subscribe((depth) => events.push(`depth ${depth}`));
    return { fixture, host, events };
  };

  it('has a file browser\'s path bar, and a toolbar for the drawing and its depth', () => {
    const { host, events } = setUp();
    expect(host.querySelector('ui-breadcrumbs')?.textContent).toContain('docs');
    expect(host.querySelector('ui-panel-toolbar .summary')?.textContent).toBe('3 files · 100 B');
    const views = Array.from(host.querySelectorAll<HTMLButtonElement>('ui-segmented button'));
    expect(views.map((button) => button.getAttribute('aria-label'))).toEqual(['Pie chart', 'Table', 'Rectangles']);
    views[2]?.click();
    expect(host.querySelector('.depth-value')?.textContent).toBe('Depth 2');
    (host.querySelector('[aria-label="More levels"]') as HTMLButtonElement).click();
    (host.querySelector('[aria-label="Fewer levels"]') as HTMLButtonElement).click();
    expect(events).toEqual(['view rectangles', 'depth 3', 'depth 1']);
  });

  it('draws the table with a bar for each share, and goes into a folder chosen', () => {
    const { host, events } = setUp();
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.table-row'));
    expect(rows.map((row) => row.querySelector('.name-text')?.textContent)).toEqual(['big', 'a', 'b', 'c.txt', '3 more']);
    expect((rows[0]?.querySelector('.bar-fill') as HTMLElement).style.width).toBe('60%');
    expect(rows[0]?.querySelector('.share-text')?.textContent).toBe('60 %');
    rows[3]?.click(); // A file: nothing to go into.
    rows[0]?.click();
    rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(events).toEqual(['open docs/big', 'open docs/big']);
  });

  it('moves between the rows with the arrows', () => {
    const { host } = setUp();
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.table-row'));
    expect(rows.map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
    rows[0]?.focus();
    rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(rows[4]);
  });

  it('draws the pie with a legend of the folder\'s own entries', () => {
    const { host, events } = setUp(model({ view: 'pie' }));
    expect(host.querySelectorAll('path.slice')).toHaveLength(5);
    expect(host.querySelector('.pie-size')?.textContent).toBe('100 B');
    const legend = Array.from(host.querySelectorAll<HTMLElement>('.legend-row'));
    expect(legend.map((row) => row.querySelector('.legend-name')?.textContent)).toEqual(['big', 'c.txt', '3 more']);
    host.querySelector('path.slice')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    legend[0]?.click();
    expect(events).toEqual(['open docs/big', 'open docs/big']);
  });

  it('answers the panel keys of a file browser: up, scan again, stop while it can', () => {
    const { host, events } = setUp();
    const body = host.querySelector('[uiPanelBody]') as HTMLElement;
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true }));
    // No Stop button: nothing is scanning, so `Escape` is left alone.
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(events).toEqual(['action up', 'action refresh']);
  });

  it('says why there is nothing to draw', () => {
    const { host } = setUp(model({ root: null, empty: { icon: 'database', title: 'Scanning…' } }));
    expect(host.querySelector('ui-empty-state')?.textContent).toContain('Scanning…');
    expect(host.querySelector('.table')).toBeNull();
  });
});
