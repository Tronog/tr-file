import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  UI_ENTRY_MIME,
  UiFileBrowser,
  type UiEntryDrop,
  type UiFileBrowserModel,
  type UiFilesDrop,
  type UiPanelKey,
  type UiSelectionChange,
} from '@tr-file/ui';

/** PRD 005, §2 — `UiFileBrowser` as a drag source, a drop target, and the clipboard's keys. */

/** jsdom has no `DataTransfer`; this is the part of one the browser uses. */
class FakeTransfer {
  private readonly data = new Map<string, string>();
  effectAllowed = 'uninitialized';
  dropEffect = 'none';
  get types(): string[] {
    return [...this.data.keys()];
  }
  setData(type: string, value: string): void {
    this.data.set(type, value);
  }
  getData(type: string): string {
    return this.data.get(type) ?? '';
  }
  setDragImage(): void {}
}

const MODEL: UiFileBrowserModel = {
  breadcrumbs: [],
  view: 'list',
  toolbarActions: [],
  columns: [{ key: 'name', label: 'Name' }],
  rows: [
    { id: 'docs', name: 'docs', icon: 'folder', cells: {}, dropTarget: true },
    { id: 'a.txt', name: 'a.txt', icon: 'file', cells: {}, selected: true },
    { id: 'b.txt', name: 'b.txt', icon: 'file', cells: {}, selected: true, focused: true },
    { id: 'c.txt', name: 'c.txt', icon: 'file', cells: {}, cut: true },
  ],
  items: [],
  dropFolder: true,
};

describe('UiFileBrowser drag and drop and clipboard', () => {
  let fixture: ComponentFixture<UiFileBrowser>;
  let drops: UiEntryDrop[];
  let commands: UiPanelKey[];
  let selections: UiSelectionChange[];

  function create(model: UiFileBrowserModel = MODEL): void {
    fixture = TestBed.createComponent(UiFileBrowser);
    fixture.componentRef.setInput('browser', model);
    fixture.detectChanges();
    drops = [];
    commands = [];
    selections = [];
    fixture.componentInstance.entryDrop.subscribe((drop) => drops.push(drop));
    fixture.componentInstance.command.subscribe((key) => commands.push(key));
    fixture.componentInstance.selectionChange.subscribe((change) => selections.push(change));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiFileBrowser] }).compileComponents();
    create();
  });

  const rowEl = (id: string): HTMLElement => fixture.nativeElement.querySelector(`tr[data-row-id="${id}"]`);
  const body = (): HTMLElement => fixture.nativeElement.querySelector('.browser-body');

  function drag(type: string, target: Element, transfer: FakeTransfer, modifiers: { ctrlKey?: boolean } = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    Object.defineProperty(event, 'ctrlKey', { value: modifiers.ctrlKey ?? false });
    Object.defineProperty(event, 'altKey', { value: false });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  /** A drag that began in another browser: the payload, and nothing of this one's. */
  function foreign(sources: string[]): FakeTransfer {
    const transfer = new FakeTransfer();
    transfer.setData(UI_ENTRY_MIME, JSON.stringify({ sources }));
    return transfer;
  }

  it('makes rows draggable and draws cut entries faded', () => {
    expect(rowEl('a.txt').getAttribute('draggable')).toBe('true');
    expect(rowEl('c.txt').classList).toContain('is-cut');
  });

  it('drags the whole selection from a selected row', () => {
    const transfer = new FakeTransfer();

    drag('dragstart', rowEl('a.txt'), transfer);

    expect(JSON.parse(transfer.getData(UI_ENTRY_MIME))).toEqual({ sources: ['a.txt', 'b.txt'] });
    expect(transfer.effectAllowed).toBe('copyMove');
    expect(selections).toEqual([]);
  });

  it('drags an unselected row alone, selecting it', () => {
    const transfer = new FakeTransfer();

    drag('dragstart', rowEl('c.txt'), transfer);

    expect(JSON.parse(transfer.getData(UI_ENTRY_MIME))).toEqual({ sources: ['c.txt'] });
    expect(selections).toEqual([{ selected: ['c.txt'], focused: 'c.txt' }]);
  });

  it('lights a folder under the drag, moving by default and copying with Ctrl', () => {
    const transfer = foreign(['x.txt']);

    expect(drag('dragover', rowEl('docs'), transfer).defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('move');
    expect(rowEl('docs').classList).toContain('is-drop-target');

    drag('dragover', rowEl('docs'), transfer, { ctrlKey: true });
    expect(transfer.dropEffect).toBe('copy');

    drag('drop', rowEl('docs'), transfer, { ctrlKey: true });
    expect(drops).toEqual([{ sources: ['x.txt'], target: 'docs', copy: true }]);
    expect(rowEl('docs').classList).not.toContain('is-drop-target');
  });

  it('takes a drag from another browser on a file or the blank space into the listed folder', () => {
    const transfer = foreign(['x.txt']);

    expect(drag('dragover', rowEl('a.txt'), transfer).defaultPrevented).toBe(true);
    expect(body().classList).toContain('is-drop-target');

    drag('drop', body(), transfer);
    expect(drops).toEqual([{ sources: ['x.txt'], target: null, copy: false }]);
  });

  it('refuses its own entries as targets, and a plain move to where they are', () => {
    const transfer = new FakeTransfer();
    drag('dragstart', rowEl('docs'), transfer);

    expect(drag('dragover', rowEl('docs'), transfer).defaultPrevented).toBe(false);
    expect(drag('dragover', body(), transfer).defaultPrevented).toBe(false);
    // A copy into the same folder is a duplicate, which is fine.
    expect(drag('dragover', body(), transfer, { ctrlKey: true }).defaultPrevented).toBe(true);

    drag('drop', rowEl('docs'), transfer);
    expect(drops).toEqual([]);
  });

  it('ignores drags that are neither entries nor files — a tab', () => {
    const transfer = new FakeTransfer();
    transfer.setData('application/x-tr-file-tab', '{}');

    expect(drag('dragover', rowEl('docs'), transfer).defaultPrevented).toBe(false);
  });

  /** PRD 003, §6: files from the system land in the folder they are dropped on — a row, or the listing's own. */
  it('takes files from outside onto a folder, or into the listed folder, as a files drop', () => {
    const files: UiFilesDrop[] = [];
    fixture.componentInstance.filesDrop.subscribe((drop) => files.push(drop));
    const file = new File(['x'], 'x.txt');
    const transfer = Object.assign(new FakeTransfer(), {
      files: [file],
      items: [{ kind: 'file', webkitGetAsEntry: () => ({ name: 'x.txt', isFile: true, isDirectory: false }) }],
    });
    transfer.setData('Files', '');

    expect(drag('dragover', rowEl('docs'), transfer).defaultPrevented).toBe(true);
    expect(rowEl('docs').classList).toContain('is-drop-target');
    drag('drop', rowEl('docs'), transfer, { ctrlKey: true });
    drag('drop', rowEl('a.txt'), transfer);

    expect(files.map((drop) => [drop.target, drop.copy, drop.files.length, drop.entries.length])).toEqual([
      ['docs', true, 1, 1],
      [null, false, 1, 1],
    ]);
    expect(drops).toEqual([]);
  });

  it('hands a drag to the system instead, when the drag is to be native', () => {
    const started: (readonly string[])[] = [];
    fixture.componentRef.setInput('nativeDrag', true);
    fixture.componentInstance.nativeDragStart.subscribe((paths) => started.push(paths));
    const transfer = new FakeTransfer();

    expect(drag('dragstart', rowEl('a.txt'), transfer).defaultPrevented).toBe(true);
    expect(started).toEqual([['a.txt', 'b.txt']]);
    expect(transfer.types).toEqual([]);
  });

  it('takes no drop where the listing does not say it may', () => {
    create({ ...MODEL, dropFolder: false });

    expect(drag('dragover', body(), foreign(['x.txt'])).defaultPrevented).toBe(false);
  });

  it('reports Ctrl+C, Ctrl+X and Ctrl+V as clipboard commands', () => {
    for (const key of ['c', 'x', 'v']) {
      rowEl('b.txt').dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
    }

    expect(commands).toEqual([
      { command: 'copy', entryId: 'b.txt' },
      { command: 'cut', entryId: 'b.txt' },
      { command: 'paste', entryId: 'b.txt' },
    ]);
  });

  it('leaves the chords to text in a document', () => {
    create({ ...MODEL, rows: [], document: { kind: 'text', title: 'a.txt', text: 'hello' } as never });

    fixture.nativeElement
      .querySelector('.browser-body')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));

    expect(commands).toEqual([]);
  });
});
