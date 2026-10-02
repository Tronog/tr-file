import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UI_TREE_ROW_MIME, UiTree, type UiTreeMove, type UiTreeNode } from '@tr-file/ui';

/** PRD 002, §6.1 — the rows of a reorderable tree (the Bookmarks) move by drag and drop, and by `Ctrl`+`↑`/`↓`. */

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
}

const row = (id: string): UiTreeNode => ({ id, label: id, depth: 0, icon: 'star', expandable: false, guides: [] });

@Component({
  imports: [UiTree],
  template: `
    <ui-tree class="ordered" [nodes]="nodes()" [reorderable]="true" (reorder)="move($event)" />
    <ui-tree class="other" [nodes]="others" [reorderable]="true" (reorder)="moves.push($event)" />
    <ui-tree class="fixed" [nodes]="others" />
  `,
})
class Host {
  readonly nodes = signal<readonly UiTreeNode[]>(['a', 'b', 'c'].map(row));
  readonly others = ['x'].map(row);
  readonly moves: UiTreeMove[] = [];

  move(move: UiTreeMove): void {
    this.moves.push(move);
    const list = this.nodes().filter((node) => node.id !== move.id);
    const at = list.findIndex((node) => node.id === move.targetId) + (move.position === 'after' ? 1 : 0);
    list.splice(at, 0, row(move.id));
    this.nodes.set(list);
  }
}

describe('Reordering a tree', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    for (const element of fixture.nativeElement.querySelectorAll('.tree-row')) {
      (element as HTMLElement).getBoundingClientRect = () => ({ top: 0, height: 20, bottom: 20 }) as DOMRect;
    }
  });

  const rowOf = (tree: string, id: string): HTMLElement =>
    [...fixture.nativeElement.querySelectorAll(`.${tree} .tree-row`)].find((element) => element.textContent.trim() === id) as HTMLElement;

  /** A row is 20px tall from y = 0; `clientY` picks its half. */
  function drag(type: string, target: HTMLElement, transfer: FakeTransfer, clientY = 0): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('drags a row, and reports a drop on the upper or lower half of another', () => {
    const transfer = new FakeTransfer();
    expect(rowOf('ordered', 'a').getAttribute('draggable')).toBe('true');
    expect(rowOf('fixed', 'x').getAttribute('draggable')).toBeNull();

    drag('dragstart', rowOf('ordered', 'a'), transfer);
    expect(transfer.getData(UI_TREE_ROW_MIME)).toBe('a');
    expect(rowOf('ordered', 'a').classList).toContain('is-dragging');

    expect(drag('dragover', rowOf('ordered', 'c'), transfer, 15).defaultPrevented).toBe(true);
    expect(rowOf('ordered', 'c').classList).toContain('drop-after');
    drag('drop', rowOf('ordered', 'c'), transfer, 15);
    drag('dragend', rowOf('ordered', 'a'), transfer);

    expect(fixture.componentInstance.moves).toEqual([{ id: 'a', targetId: 'c', position: 'after' }]);
    expect(rowOf('ordered', 'c').classList).not.toContain('drop-after');
    expect(rowOf('ordered', 'a').classList).not.toContain('is-dragging');
  });

  it('takes no drop from itself or from another tree', () => {
    const transfer = new FakeTransfer();
    drag('dragstart', rowOf('ordered', 'a'), transfer);
    expect(drag('dragover', rowOf('ordered', 'a'), transfer).defaultPrevented).toBe(false);
    expect(drag('dragover', rowOf('other', 'x'), transfer).defaultPrevented).toBe(false);
    drag('drop', rowOf('other', 'x'), transfer);
    drag('dragend', rowOf('ordered', 'a'), transfer);

    expect(fixture.componentInstance.moves).toEqual([]);
  });

  it('moves a row a slot with Ctrl+Arrow, keeping the keyboard on it', async () => {
    const key = (id: string, key: string) => {
      rowOf('ordered', id).focus();
      rowOf('ordered', id).dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };

    key('a', 'ArrowDown');
    await fixture.whenStable();
    expect(fixture.componentInstance.nodes().map((node) => node.id)).toEqual(['b', 'a', 'c']);
    expect(document.activeElement).toBe(rowOf('ordered', 'a'));

    key('b', 'ArrowUp'); // Already first.
    key('c', 'ArrowUp');
    expect(fixture.componentInstance.moves).toEqual([
      { id: 'a', targetId: 'b', position: 'after' },
      { id: 'c', targetId: 'a', position: 'before' },
    ]);
  });
});
