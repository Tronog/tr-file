import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileList, UiTree } from '@tr-file/ui';
import type { UiFileColumn, UiFileRow, UiTreeNode } from '@tr-file/ui';

const TREE_NODES: readonly UiTreeNode[] = [
  { id: 'prj', label: 'prj', depth: 0, icon: 'folder-open', tint: 'folder', expandable: true, expanded: true, guides: [] },
  {
    id: 'prj/backend',
    label: 'backend',
    depth: 1,
    icon: 'folder',
    tint: 'folder',
    expandable: true,
    expanded: false,
    meta: '12 items',
    guides: [true],
  },
  {
    id: 'prj/package.json',
    label: 'package.json',
    depth: 1,
    icon: 'file',
    tint: 'json',
    expandable: false,
    selected: true,
    focused: true,
    decoration: 'modified',
    meta: 'M',
    guides: [true],
  },
];

const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name', sort: 'asc' },
  { key: 'size', label: 'Size', width: '90px', align: 'end' },
  { key: 'modified', label: 'Modified', width: '150px' },
];

const ROWS: readonly UiFileRow[] = [
  { id: 'a.ts', name: 'a.ts', icon: 'file', tint: 'ts', cells: { size: '1.2 KB', modified: 'Sep 20, 13:04' } },
  {
    id: 'b.md',
    name: 'b.md',
    icon: 'file',
    tint: 'md',
    cells: { size: '612 B', modified: 'Sep 19, 18:02' },
    selected: true,
    focused: true,
  },
  {
    id: 'c.json',
    name: 'c.json',
    icon: 'file',
    tint: 'json',
    cells: { size: '942 B', modified: 'Sep 18, 09:00' },
    inactiveSelected: true,
  },
];

describe('UiTree', () => {
  let fixture: ComponentFixture<UiTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTree] }).compileComponents();
    fixture = TestBed.createComponent(UiTree);
    fixture.componentRef.setInput('nodes', TREE_NODES);
    fixture.componentRef.setInput('label', 'Workspace');
    fixture.detectChanges();
  });

  const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('[role="treeitem"]'));

  it('renders one treeitem per node inside a labelled tree', () => {
    const tree: HTMLElement = fixture.nativeElement.querySelector('[role="tree"]');

    expect(tree.getAttribute('aria-label')).toBe('Workspace');
    expect(rows()).toHaveLength(3);
    expect(rows().map((row) => row.querySelector('.file-name')?.textContent?.trim())).toEqual([
      'prj',
      'backend',
      'package.json',
    ]);
  });

  it('exposes depth as a one-based aria-level', () => {
    expect(rows().map((row) => row.getAttribute('aria-level'))).toEqual(['1', '2', '2']);
  });

  it('sets aria-expanded on expandable rows only', () => {
    expect(rows().map((row) => row.getAttribute('aria-expanded'))).toEqual(['true', 'false', null]);
    expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
  });

  it('makes the focused row the single tab stop', () => {
    expect(rows().map((row) => row.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('renders the meta hint and one indent guide per level', () => {
    expect(rows()[1].querySelector('.file-meta')?.textContent?.trim()).toBe('12 items');
    expect(rows()[0].querySelector('.file-meta')).toBeNull();
    expect(rows()[0].querySelectorAll('.indent i')).toHaveLength(0);
    expect(rows()[1].querySelectorAll('.indent i')).toHaveLength(1);
  });

  it('emits activate when a row is clicked', () => {
    const activated: string[] = [];
    fixture.componentInstance.activate.subscribe((id) => activated.push(id));

    rows()[1].click();

    expect(activated).toEqual(['prj/backend']);
  });

  it('announces a node whose children are still loading, and spins its twisty', () => {
    fixture.componentRef.setInput('nodes', [
      { ...(TREE_NODES[0] as UiTreeNode), busy: true },
      ...TREE_NODES.slice(1),
    ]);
    fixture.detectChanges();

    expect(rows().map((row) => row.getAttribute('aria-busy'))).toEqual(['true', null, null]);
    expect(rows()[0].querySelector('.twisty .spinner')).not.toBeNull();
    // The chevron gives way to the spinner while the listing is in flight.
    expect(rows()[0].querySelector('.twisty ui-icon')).toBeNull();
    expect(rows()[1].querySelector('.twisty .spinner')).toBeNull();
  });

  it('emits toggle — and not activate — when the twisty is clicked', () => {
    const activated: string[] = [];
    const toggled: string[] = [];
    fixture.componentInstance.activate.subscribe((id) => activated.push(id));
    fixture.componentInstance.toggle.subscribe((id) => toggled.push(id));

    rows()[0].querySelector<HTMLElement>('.twisty')!.click();

    expect(toggled).toEqual(['prj']);
    expect(activated).toEqual([]);
  });
});

describe('UiFileList', () => {
  let fixture: ComponentFixture<UiFileList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileList] }).compileComponents();
    fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('label', 'prj listing');
    fixture.detectChanges();
  });

  const headers = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('thead th'));
  const bodyRows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));

  it('renders a header per column and names the table', () => {
    expect(fixture.nativeElement.querySelector('caption').textContent.trim()).toBe('prj listing');
    expect(headers().map((th) => th.textContent?.trim())).toEqual(['Name', 'Size', 'Modified']);
    expect(headers().every((th) => th.getAttribute('scope') === 'col')).toBe(true);
  });

  it('marks the sorted column with aria-sort and leaves the others unsorted', () => {
    expect(headers().map((th) => th.getAttribute('aria-sort'))).toEqual(['ascending', null, null]);
  });

  it('renders the name cell and looks the other cells up by column key', () => {
    const cells = Array.from(bodyRows()[0].querySelectorAll('td')).map((td) => td.textContent?.trim());

    expect(cells).toEqual(['a.ts', '1.2 KB', 'Sep 20, 13:04']);
    expect(bodyRows()).toHaveLength(3);
  });

  it('reports both flavours of selection as aria-selected', () => {
    expect(bodyRows().map((tr) => tr.getAttribute('aria-selected'))).toEqual(['false', 'true', 'true']);
    expect(bodyRows()[1].classList).toContain('is-selected');
    expect(bodyRows()[2].classList).toContain('is-inactive-selected');
    expect(bodyRows()[2].classList).not.toContain('is-selected');
  });

  it('makes the focused row the single tab stop', () => {
    expect(bodyRows().map((tr) => tr.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('emits select on click and activate on double click', () => {
    const selected: string[] = [];
    const activated: string[] = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
    fixture.componentInstance.activate.subscribe((id) => activated.push(id));

    bodyRows()[0].click();
    bodyRows()[2].dispatchEvent(new MouseEvent('dblclick'));

    expect(selected).toEqual(['a.ts']);
    expect(activated).toEqual(['c.json']);
  });

  it('emits activate when Enter is pressed on a row', () => {
    const activated: string[] = [];
    fixture.componentInstance.activate.subscribe((id) => activated.push(id));

    bodyRows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    bodyRows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(activated).toEqual(['b.md']);
  });
});
