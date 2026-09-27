import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiBreadcrumbs, UiContextMenu, UiFileBrowser, UiFileList, UiTabBar, UiTree } from '@tr-file/ui';
import type {
  UiContextMenuRequest,
  UiFileBrowserModel,
  UiFileColumn,
  UiFileRow,
  UiPanelKey,
  UiSelectionChange,
} from '@tr-file/ui';

/**
 * PRD 003, §5 — what every file manager has, as the library reports it:
 * sortable headers, `F2` and `Shift`+`Delete`, the editable path bar, the
 * filter box, right-click menus on entries, tree rows and tabs, and a menu
 * that stays on screen. The components only ever report; the specs check
 * what they report, through their real DOM.
 */

function keydown(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}

const COLUMNS: readonly UiFileColumn[] = [
  { key: 'name', label: 'Name', sort: 'desc' },
  { key: 'size', label: 'Size', align: 'end' },
];

const ROWS: readonly UiFileRow[] = [
  { id: 'docs', name: 'docs', icon: 'folder', cells: { size: '—' }, dropTarget: true },
  { id: 'a.txt', name: 'a.txt', icon: 'file', cells: { size: '1 B' }, focused: true, selected: true },
  { id: 'b.txt', name: 'b.txt', icon: 'file', cells: { size: '2 B' } },
];

describe('UiFileList, sortable', () => {
  let fixture: ComponentFixture<UiFileList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileList] }).compileComponents();
    fixture = TestBed.createComponent(UiFileList);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', ROWS);
  });

  it('draws headers as buttons that report their column, with the order on the sorted one', () => {
    const sorts: string[] = [];
    fixture.componentInstance.sort.subscribe((key) => sorts.push(key));
    fixture.componentRef.setInput('sortable', true);
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('th .sort-button')) as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Name', 'Size']);
    expect(fixture.nativeElement.querySelector('th')?.getAttribute('aria-sort')).toBe('descending');
    buttons[1]?.click();
    expect(sorts).toEqual(['size']);
  });

  /** PRD 002, §3.1: sorting is done from the header, the work goes on in the rows. */
  it('gives focus back to the cursor row, in its new place, once the rows are re-sorted', () => {
    document.body.appendChild(fixture.nativeElement);
    fixture.componentRef.setInput('sortable', true);
    fixture.detectChanges();
    fixture.componentInstance.sort.subscribe(() => fixture.componentRef.setInput('rows', [...ROWS].reverse()));

    const header = fixture.nativeElement.querySelector('th .sort-button') as HTMLButtonElement;
    header.focus();
    header.click();
    fixture.detectChanges();

    const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(rows.map((row) => row.dataset['rowId'])).toEqual(['b.txt', 'a.txt', 'docs']);
    expect(document.activeElement).toBe(rows[1]);
    fixture.nativeElement.remove();
  });

  it('focuses and selects the first row after a sort when nothing is selected', () => {
    const changes: UiSelectionChange[] = [];
    fixture.componentRef.setInput('rows', ROWS.map(({ selected: _selected, ...row }) => row));
    fixture.componentRef.setInput('sortable', true);
    fixture.detectChanges();
    fixture.componentInstance.selectionChange.subscribe((change) => changes.push(change));

    (fixture.nativeElement.querySelector('th .sort-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(changes).toEqual([{ selected: ['docs'], focused: 'docs' }]);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('tbody tr'));
  });

  it('keeps plain headers when it is not sortable', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sort-button')).toBeNull();
  });

  it('reports Shift+Delete as delete for good, and leaves F2 to the window', () => {
    const commands: UiPanelKey[] = [];
    fixture.componentInstance.command.subscribe((key) => commands.push(key));
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelectorAll('tbody tr')[1] as HTMLElement;

    row.dispatchEvent(keydown('F2'));
    row.dispatchEvent(keydown('Delete', { shiftKey: true }));
    row.dispatchEvent(keydown('Delete'));

    expect(commands).toEqual([
      { command: 'delete-permanently', entryId: 'a.txt' },
      { command: 'delete', entryId: 'a.txt' },
    ]);
  });
});

const BROWSER: UiFileBrowserModel = {
  breadcrumbs: [
    { id: 'root', label: 'tr-file' },
    { id: 'docs', label: 'docs' },
  ],
  location: '/docs',
  view: 'list',
  toolbarActions: [{ id: 'up', label: 'Up', icon: 'arrow-up' }],
  searchPlaceholder: 'Filter',
  filterText: '',
  sortable: true,
  columns: COLUMNS,
  rows: ROWS,
  items: [],
  dropFolder: true,
};

describe('UiFileBrowser, what every file manager has', () => {
  let fixture: ComponentFixture<UiFileBrowser>;
  let commands: UiPanelKey[];
  let menus: UiContextMenuRequest[];
  let selections: UiSelectionChange[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileBrowser] }).compileComponents();
    fixture = TestBed.createComponent(UiFileBrowser);
    fixture.componentRef.setInput('browser', BROWSER);
    fixture.detectChanges();
    commands = [];
    menus = [];
    selections = [];
    fixture.componentInstance.command.subscribe((key) => commands.push(key));
    fixture.componentInstance.contextMenu.subscribe((request) => menus.push(request));
    fixture.componentInstance.selectionChange.subscribe((change) => selections.push(change));
    document.body.append(fixture.nativeElement);
  });

  afterEach(() => fixture.nativeElement.remove());

  const $ = <T extends Element = HTMLElement>(selector: string): T => fixture.nativeElement.querySelector(selector) as T;
  const row = (index: number): HTMLElement => fixture.nativeElement.querySelectorAll('tbody tr')[index] as HTMLElement;

  it('a right-click on an unselected entry selects it, then asks for its menu where the pointer is', () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
    row(2).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(selections).toEqual([{ selected: ['b.txt'], focused: 'b.txt' }]);
    expect(menus).toEqual([{ target: 'b.txt', x: 40, y: 50 }]);
  });

  it('a right-click on a selected entry keeps the selection, and on blank space asks for the folder’s menu', () => {
    row(1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    $('.browser-body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));

    expect(selections).toEqual([]);
    expect(menus.map((menu) => menu.target)).toEqual(['a.txt', null]);
  });

  it('Shift+F10 asks for the menu of the entry focus is on', () => {
    row(1).focus();
    row(1).dispatchEvent(keydown('F10', { shiftKey: true }));
    expect(menus.map((menu) => menu.target)).toEqual(['a.txt']);
  });

  it('reports Ctrl+Z, Ctrl+Shift+N and the mouse’s back and forward buttons', () => {
    row(1).dispatchEvent(keydown('z', { ctrlKey: true }));
    row(1).dispatchEvent(keydown('N', { ctrlKey: true, shiftKey: true }));
    fixture.nativeElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 3 }));
    fixture.nativeElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 4 }));

    expect(commands.map((key) => key.command)).toEqual(['undo', 'new-folder', 'back', 'forward']);
  });

  it('Ctrl+F goes to the filter box; typing reports it, Escape empties it, ↓ goes back to the listing', () => {
    const filters: string[] = [];
    fixture.componentInstance.filterChange.subscribe((text) => filters.push(text));
    row(1).focus();
    row(1).dispatchEvent(keydown('f', { ctrlKey: true }));
    const field = $<HTMLInputElement>('ui-search-field input');
    expect(document.activeElement).toBe(field);

    field.value = 'a';
    field.dispatchEvent(new Event('input'));
    fixture.componentRef.setInput('browser', { ...BROWSER, filterText: 'a' });
    fixture.detectChanges();
    field.dispatchEvent(keydown('Escape'));
    field.dispatchEvent(keydown('ArrowDown'));

    expect(filters).toEqual(['a', '']);
    expect(document.activeElement).toBe(row(1));
    // Ctrl+Z in the box is the box's own.
    field.dispatchEvent(keydown('z', { ctrlKey: true }));
    expect(commands).toEqual([]);
  });

  it('Ctrl+L turns the path bar into a field holding the path; Enter reports what was typed', () => {
    const paths: string[] = [];
    fixture.componentInstance.pathSubmit.subscribe((path) => paths.push(path));
    row(1).focus();
    row(1).dispatchEvent(keydown('l', { ctrlKey: true }));
    fixture.detectChanges();

    const field = $<HTMLInputElement>('input.location');
    expect(field.value).toBe('/docs');
    expect(document.activeElement).toBe(field);
    field.value = '/docs/prd';
    field.dispatchEvent(keydown('Enter'));
    fixture.detectChanges();

    expect(paths).toEqual(['/docs/prd']);
    expect($('input.location')).toBeNull();
    expect(document.activeElement).toBe(row(1));
  });

  it('takes text selected in the path field for no crumb — the DOM `select` event is not the output', () => {
    const crumbs: unknown[] = [];
    fixture.componentInstance.breadcrumbSelect.subscribe((id) => crumbs.push(id));
    row(1).focus();
    row(1).dispatchEvent(keydown('l', { ctrlKey: true }));
    fixture.detectChanges();

    // What the browser fires as the field's text is selected — which editing the path does at once.
    $<HTMLInputElement>('input.location').dispatchEvent(new Event('select', { bubbles: true }));
    expect(crumbs).toEqual([]);
  });

  it('answers the model’s requests to focus the filter and edit the path', () => {
    fixture.componentRef.setInput('browser', { ...BROWSER, filterFocus: 1 });
    fixture.detectChanges();
    expect(document.activeElement).toBe($('ui-search-field input'));

    fixture.componentRef.setInput('browser', { ...BROWSER, filterFocus: 1, locationEdit: 1 });
    fixture.detectChanges();
    fixture.detectChanges();
    expect($('input.location')).not.toBeNull();
  });
});

describe('UiBreadcrumbs, as an address bar', () => {
  let fixture: ComponentFixture<UiBreadcrumbs>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiBreadcrumbs] }).compileComponents();
    fixture = TestBed.createComponent(UiBreadcrumbs);
    fixture.componentRef.setInput('items', [{ id: 'root', label: 'tr-file' }]);
  });

  it('cannot be edited without a location', () => {
    fixture.detectChanges();
    fixture.componentInstance.edit();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.querySelector('.edit')).toBeNull();
  });

  it('edits on a click on its blank space, not on a crumb, and Escape puts the crumbs back', () => {
    const selected: string[] = [];
    fixture.componentInstance.crumbSelect.subscribe((id) => selected.push(id));
    fixture.componentRef.setInput('location', '/');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.crumb') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(selected).toEqual(['root']);
    expect(fixture.nativeElement.querySelector('input')).toBeNull();

    (fixture.nativeElement.querySelector('nav') as HTMLElement).click();
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(field.value).toBe('/');
    field.dispatchEvent(keydown('Escape'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
});

describe('Context menus on tree rows and tabs', () => {
  it('UiTree reports a right-click and Shift+F10 on a row', async () => {
    await TestBed.configureTestingModule({ imports: [UiTree] }).compileComponents();
    const fixture = TestBed.createComponent(UiTree);
    fixture.componentRef.setInput('nodes', [
      { id: 'docs', label: 'docs', depth: 0, icon: 'folder', expandable: true, guides: [] },
    ]);
    fixture.detectChanges();
    const menus: UiContextMenuRequest[] = [];
    fixture.componentInstance.contextMenu.subscribe((request) => menus.push(request));
    const row = fixture.nativeElement.querySelector('[role="treeitem"]') as HTMLElement;

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 7, clientY: 8 });
    row.dispatchEvent(event);
    row.dispatchEvent(keydown('ContextMenu'));

    expect(event.defaultPrevented).toBe(true);
    expect(menus.map((menu) => menu.target)).toEqual(['docs', 'docs']);
    expect(menus[0]).toMatchObject({ x: 7, y: 8 });
  });

  it('UiTabBar reports a right-click on a tab', async () => {
    await TestBed.configureTestingModule({ imports: [UiTabBar] }).compileComponents();
    const fixture = TestBed.createComponent(UiTabBar);
    fixture.componentRef.setInput('tabs', [{ id: 't1', label: 'docs', icon: 'folder', active: true }]);
    fixture.componentRef.setInput('groupId', 'g');
    fixture.detectChanges();
    const menus: UiContextMenuRequest[] = [];
    fixture.componentInstance.tabContextMenu.subscribe((request) => menus.push(request));

    (fixture.nativeElement.querySelector('[role="tab"]') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 2 }),
    );
    expect(menus).toEqual([{ target: 't1', x: 1, y: 2 }]);
  });
});

describe('UiContextMenu near the edge of the window', () => {
  it('moves back inside the viewport rather than running off it', async () => {
    await TestBed.configureTestingModule({ imports: [UiContextMenu] }).compileComponents();
    const fixture = TestBed.createComponent(UiContextMenu);
    fixture.componentRef.setInput('items', [{ id: 'a', label: 'A' }]);
    fixture.componentRef.setInput('fixed', true);
    fixture.componentRef.setInput('x', window.innerWidth - 10);
    fixture.componentRef.setInput('y', window.innerHeight - 10);
    const host = fixture.nativeElement as HTMLElement;
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      left: window.innerWidth - 10,
      top: window.innerHeight - 10,
      right: window.innerWidth + 230,
      bottom: window.innerHeight + 22,
      width: 240,
      height: 32,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.style.left).toBe(`${window.innerWidth - 244}px`);
    expect(host.style.top).toBe(`${window.innerHeight - 36}px`);
  });
});
