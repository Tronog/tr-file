import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiDocumentView, UiFileList, UiProgressDialog, UiTransferList, UiTree } from '@tr-file/ui';
import type {
  UiDocumentModel,
  UiFileColumn,
  UiFileRow,
  UiPanelKey,
  UiProgressDialogModel,
  UiTreeNode,
} from '@tr-file/ui';

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

describe('UiDocumentView', () => {
  let fixture: ComponentFixture<UiDocumentView>;

  const render = async (document: UiDocumentModel): Promise<void> => {
    await TestBed.configureTestingModule({ imports: [UiDocumentView] }).compileComponents();
    fixture = TestBed.createComponent(UiDocumentView);
    fixture.componentRef.setInput('document', document);
    fixture.detectChanges();
  };

  const host = (): HTMLElement => fixture.nativeElement;

  it('renders markdown HTML the app has already produced', async () => {
    await render({
      path: 'docs/README.md',
      kind: 'markdown',
      html: '<h1>Title</h1><p>Body <code>x</code></p>',
      meta: '512 B · 31 lines',
    });

    expect(host().querySelector('.markdown h1')?.textContent).toBe('Title');
    expect(host().querySelector('.markdown code')?.textContent).toBe('x');
    expect(host().querySelector('pre')).toBeNull();
  });

  it('strips anything dangerous out of that HTML', async () => {
    await render({
      path: 'evil.md',
      kind: 'markdown',
      html: '<p>ok</p><script>window.pwned = true;</script>',
    });

    // Angular's sanitiser runs on the [innerHTML] binding; the app is not
    // trusted to have produced safe HTML just because it produced it.
    expect(host().querySelector('script')).toBeNull();
    expect(host().textContent).toContain('ok');
  });

  it('shows plain text verbatim, without rendering it', async () => {
    await render({ path: 'main.ts', kind: 'text', text: 'const x = 1; // **not bold**' });

    expect(host().querySelector('pre')?.textContent).toBe('const x = 1; // **not bold**');
    expect(host().querySelector('.markdown')).toBeNull();
    expect(host().querySelector('strong')).toBeNull();
  });

  it('names the region after the path and says it is read-only', async () => {
    await render({ path: 'docs/README.md', kind: 'text', text: 'x', meta: '512 B · 1 line' });

    expect(host().querySelector('article')?.getAttribute('aria-label')).toBe('docs/README.md');
    expect(host().textContent).toContain('Read-only');
    expect(host().textContent).toContain('512 B · 1 line');
    // Nothing in a read-only view may be editable.
    expect(host().querySelector('input, textarea, [contenteditable]')).toBeNull();
  });
});

describe('UiTree keyboard', () => {
  let fixture: ComponentFixture<UiTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTree] }).compileComponents();
    fixture = TestBed.createComponent(UiTree);
    fixture.componentRef.setInput('nodes', TREE_NODES);
    fixture.detectChanges();
  });

  const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('[role="treeitem"]'));

  const press = (index: number, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    rows()[index]?.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  /**
   * The twisty is decorative, so these keys are the only way a keyboard user
   * can open or close a directory.
   */
  it('opens a closed directory with ArrowRight and closes an open one with ArrowLeft', () => {
    const toggled: string[] = [];
    fixture.componentInstance.toggle.subscribe((id: string) => toggled.push(id));

    press(1, 'ArrowRight'); // prj/backend is collapsed
    press(0, 'ArrowLeft'); // prj is expanded

    expect(toggled).toEqual(['prj/backend', 'prj']);
  });

  it('steps into an open directory with ArrowRight instead of toggling it', () => {
    const toggled: string[] = [];
    fixture.componentInstance.toggle.subscribe((id: string) => toggled.push(id));

    press(0, 'ArrowRight'); // prj is already open

    expect(toggled).toEqual([]);
    expect(document.activeElement).toBe(rows()[1]);
  });

  it('steps out to the parent with ArrowLeft from a leaf', () => {
    press(2, 'ArrowLeft');

    expect(document.activeElement).toBe(rows()[0]);
  });

  it('moves between rows with the arrows, Home and End', () => {
    press(0, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);

    press(1, 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);

    press(0, 'End');
    expect(document.activeElement).toBe(rows()[2]);

    press(2, 'Home');
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('emits open on a double click, separately from activate', () => {
    const activated: string[] = [];
    const opened: string[] = [];
    fixture.componentInstance.activate.subscribe((id: string) => activated.push(id));
    fixture.componentInstance.open.subscribe((id: string) => opened.push(id));

    rows()[2]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(opened).toEqual(['prj/package.json']);
    expect(activated).toEqual([]);
  });

  it('claims the keys it handles and ignores the rest', () => {
    expect(press(0, 'ArrowDown').defaultPrevented).toBe(true);
    expect(press(0, 'a').defaultPrevented).toBe(false);
  });

  it('does not move past either end', () => {
    rows()[0]?.focus();
    press(0, 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);

    rows()[2]?.focus();
    press(2, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[2]);
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

  it('reports Enter as an open command rather than acting on it', () => {
    const commands: UiPanelKey[] = [];
    fixture.componentInstance.command.subscribe((key) => commands.push(key));

    bodyRows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(commands).toEqual([{ command: 'open', entryId: 'b.md' }]);
  });
});

/** PRD 005, §1 — the Progress tab's rows and the progress window. */
describe('UiTransferList', () => {
  it('gives a cancellable row a stop button that reports its id', async () => {
    await TestBed.configureTestingModule({ imports: [UiTransferList] }).compileComponents();
    const fixture = TestBed.createComponent(UiTransferList);
    fixture.componentRef.setInput('transfers', [
      { id: 'a', name: 'Copying a', icon: 'copy', progress: 40, statusLabel: '40%', cancellable: true, detail: '/docs/a' },
      { id: 'b', name: 'Copying b', icon: 'check', progress: 100, statusLabel: 'done' },
    ]);
    fixture.detectChanges();
    const cancelled: string[] = [];
    fixture.componentInstance.cancel.subscribe((id) => cancelled.push(id));

    const buttons = fixture.nativeElement.querySelectorAll('ui-icon-button button') as NodeListOf<HTMLButtonElement>;
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Cancel Copying a');
    buttons[0]?.click();

    expect(cancelled).toEqual(['a']);
    expect(fixture.nativeElement.querySelector('.transfer-name').getAttribute('title')).toBe('/docs/a');
  });
});

describe('UiProgressDialog', () => {
  let fixture: ComponentFixture<UiProgressDialog>;
  const model = (overrides: Partial<UiProgressDialogModel> = {}): UiProgressDialogModel => ({
    title: 'Copying 3 items to /docs',
    current: '/src/a.txt',
    progress: 40,
    status: '1 of 3 items',
    state: 'running',
    ...overrides,
  });
  const buttons = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('button'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiProgressDialog] }).compileComponents();
    fixture = TestBed.createComponent(UiProgressDialog);
  });

  it('offers Run in Background and Cancel while running', () => {
    fixture.componentRef.setInput('model', model());
    fixture.detectChanges();
    const said: string[] = [];
    fixture.componentInstance.background.subscribe(() => said.push('background'));
    fixture.componentInstance.cancel.subscribe(() => said.push('cancel'));

    expect(buttons().map((button) => button.textContent?.trim())).toEqual(['Run in Background', 'Cancel']);
    expect(fixture.nativeElement.querySelector('ui-progress').getAttribute('aria-valuenow')).toBe('40');
    buttons().forEach((button) => button.click());

    expect(said).toEqual(['background', 'cancel']);
  });

  it('says it is cancelling, and will not be asked twice', () => {
    fixture.componentRef.setInput('model', model({ cancelling: true }));
    fixture.detectChanges();

    expect(buttons()[1]?.textContent?.trim()).toBe('Cancelling…');
    expect(buttons()[1]?.disabled).toBe(true);
  });

  it('says why it failed, with only Close left', () => {
    fixture.componentRef.setInput('model', model({ state: 'failed', error: 'Permission denied' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent.trim()).toBe('Permission denied');
    expect(buttons().map((button) => button.textContent?.trim())).toEqual(['Close']);
  });
});
