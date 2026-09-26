import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiFileBrowser, UiFileList } from '@tr-file/ui';
import type { UiFileBrowserModel, UiFileColumn, UiFileRow, UiPanelView } from '@tr-file/ui';

/**
 * PRD 002, §4.1 — the tree view: the details table, with folders that open in
 * place. The rows arrive already flattened; the table indents them, draws the
 * twisty and answers `→`/`←`, and reports opening and closing as `toggle`.
 */

const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name', sort: 'asc' },
  { key: 'size', label: 'Size', align: 'end' },
];

/** `docs` is open and holds `docs/prd` (closed) and `docs/NOTES.md`; `main.ts` is a file. */
const TREE: readonly UiFileRow[] = [
  { id: 'docs', name: 'docs', icon: 'folder-open', cells: {}, depth: 0, expandable: true, expanded: true, focused: true },
  { id: 'docs/prd', name: 'prd', icon: 'folder', cells: {}, depth: 1, expandable: true, expanded: false },
  { id: 'docs/NOTES.md', name: 'NOTES.md', icon: 'file', cells: { size: '1 KB' }, depth: 1, expandable: false },
  { id: 'main.ts', name: 'main.ts', icon: 'file', cells: { size: '612 B' }, depth: 0, expandable: false },
];

function keydown(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}

describe('UiFileList as a tree', () => {
  let fixture: ComponentFixture<UiFileList>;
  let toggled: string[];
  let selected: string[];
  let activated: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileList] }).compileComponents();
    fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', TREE);
    fixture.componentRef.setInput('tree', true);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    toggled = [];
    selected = [];
    activated = [];
    fixture.componentInstance.toggle.subscribe((id) => toggled.push(id));
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
    fixture.componentInstance.activate.subscribe((id) => activated.push(id));
  });

  afterEach(() => fixture.nativeElement.remove());

  const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));

  const press = (index: number, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent => {
    const event = keydown(key, modifiers);
    rows()[index]?.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  /** Columns stay the details view's: a tree grid, not a second kind of list. */
  it('keeps the details columns, and says it is a tree grid', () => {
    const table = fixture.nativeElement.querySelector('table') as HTMLElement;
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent?.trim());

    expect(table.getAttribute('role')).toBe('treegrid');
    expect(headers).toEqual(['Name', 'Size']);
    expect(rows()[2]?.querySelectorAll('td')[1]?.textContent?.trim()).toBe('1 KB');
  });

  it('gives each row its level, and each folder its state', () => {
    expect(rows().map((row) => row.getAttribute('aria-level'))).toEqual(['1', '2', '2', '1']);
    expect(rows().map((row) => row.getAttribute('aria-expanded'))).toEqual(['true', 'false', null, null]);
  });

  it('indents by depth, keeping a twisty slot on every row so icons line up', () => {
    const cells = rows().map((row) => row.querySelector('.name-cell') as HTMLElement);

    expect(cells.map((cell) => cell.style.paddingLeft)).toEqual(['0px', '16px', '16px', '0px']);
    expect(rows().every((row) => row.querySelector('.twisty') !== null)).toBe(true);
    expect(rows()[2]?.querySelector('.twisty')?.classList).toContain('is-hidden');
  });

  it('spins the twisty of a folder whose contents are still coming', () => {
    fixture.componentRef.setInput('rows', [{ ...TREE[1]!, expanded: true, busy: true }]);
    fixture.detectChanges();

    expect(rows()[0]?.querySelector('.twisty .spinner')).not.toBeNull();
    expect(rows()[0]?.getAttribute('aria-busy')).toBe('true');
  });

  /** The twisty only folds: the row is neither selected nor opened by it. */
  it('reports a twisty click as a toggle, and nothing else', () => {
    const twisty = rows()[1]?.querySelector('.twisty') as HTMLElement;
    twisty.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    twisty.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(toggled).toEqual(['docs/prd']);
    expect(selected).toEqual([]);
    expect(activated).toEqual([]);
  });

  describe('→ and ←', () => {
    it('opens a closed folder on →', () => {
      expect(press(1, 'ArrowRight').defaultPrevented).toBe(true);

      expect(toggled).toEqual(['docs/prd']);
    });

    it('steps into an open folder on →, selecting its first child', () => {
      press(0, 'ArrowRight');

      expect(toggled).toEqual([]);
      expect(document.activeElement).toBe(rows()[1]);
      expect(selected).toEqual(['docs/prd']);
    });

    it('closes an open folder on ←', () => {
      press(0, 'ArrowLeft');

      expect(toggled).toEqual(['docs']);
    });

    it('steps out to the parent folder on ← from anything else', () => {
      press(2, 'ArrowLeft');

      expect(toggled).toEqual([]);
      expect(document.activeElement).toBe(rows()[0]);
      expect(selected).toEqual(['docs']);
    });

    /** `Alt`+`←` is the panel's Back, and must pass through untouched. */
    it('leaves Alt+← to the panel', () => {
      expect(press(2, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);

      expect(toggled).toEqual([]);
    });

    /** Outside tree mode the arrows keep meaning nothing to the table. */
    it('does nothing in a flat list', () => {
      fixture.componentRef.setInput('tree', false);
      fixture.detectChanges();

      expect(press(1, 'ArrowRight').defaultPrevented).toBe(false);
      expect(press(2, 'ArrowLeft').defaultPrevented).toBe(false);
      expect(toggled).toEqual([]);
      expect(fixture.nativeElement.querySelector('table').getAttribute('role')).toBeNull();
      expect(fixture.nativeElement.querySelector('.twisty')).toBeNull();
    });
  });
});

describe('UiFileBrowser tree view', () => {
  let fixture: ComponentFixture<UiFileBrowser>;

  const BROWSER: UiFileBrowserModel = {
    breadcrumbs: [],
    view: 'list',
    toolbarActions: [],
    showViewSwitch: true,
    columns: COLUMNS,
    rows: TREE,
    items: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileBrowser] }).compileComponents();
    fixture = TestBed.createComponent(UiFileBrowser);
    fixture.componentRef.setInput('browser', BROWSER);
    fixture.detectChanges();
  });

  it('offers the tree as a third view', () => {
    const views: UiPanelView[] = [];
    fixture.componentInstance.viewChange.subscribe((view) => views.push(view));

    const tree = fixture.nativeElement.querySelector('[aria-label="Tree view"]') as HTMLElement;
    tree.click();

    expect(views).toEqual(['tree']);
  });

  it('renders the tree view as a tree grid and reports its folds', () => {
    fixture.componentRef.setInput('browser', { ...BROWSER, view: 'tree' });
    fixture.detectChanges();
    const toggled: string[] = [];
    fixture.componentInstance.rowToggle.subscribe((id) => toggled.push(id));

    const table = fixture.nativeElement.querySelector('table') as HTMLElement;
    (table.querySelector('.twisty') as HTMLElement).click();

    expect(table.getAttribute('role')).toBe('treegrid');
    expect(toggled).toEqual(['docs']);
  });

  it('keeps the list view flat', () => {
    expect(fixture.nativeElement.querySelector('table').getAttribute('role')).toBeNull();
  });
});
