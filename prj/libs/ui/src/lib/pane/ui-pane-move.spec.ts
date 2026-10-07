import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UI_PANE_MIME, UiPane, UiSidebar, type UiPaneMove, type UiPaneResize } from '../../public-api';

/**
 * PRD 002, §5.1 — the panes of a sidebar move by drag and drop, and by `Ctrl`+`↑`/`↓`;
 * §5.2 — and resize by the sash on their top edge.
 */

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

@Component({
  imports: [UiSidebar, UiPane],
  template: `
    <ui-sidebar title="Left">
      @for (id of order(); track id) {
        <ui-pane
          [paneId]="id"
          [title]="id"
          [expanded]="!collapsed().includes(id)"
          [size]="sizes()[id] ?? null"
          (paneMove)="moves.push($event)"
          (paneResize)="resizes.push($event)"
        />
      }
    </ui-sidebar>
    <ui-sidebar title="Right">
      <ui-pane paneId="other" title="other" (paneMove)="moves.push($event)" />
    </ui-sidebar>
  `,
})
class Host {
  readonly order = signal(['a', 'b', 'c']);
  readonly collapsed = signal<string[]>([]);
  readonly sizes = signal<Record<string, number>>({});
  readonly moves: UiPaneMove[] = [];
  readonly resizes: UiPaneResize[] = [];
}

describe('Moving sidebar panes', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  const pane = (id: string): HTMLElement => fixture.nativeElement.querySelector(`[data-pane-id="${id}"]`) as HTMLElement;
  const header = (id: string): HTMLElement => pane(id).querySelector('.pane-header') as HTMLElement;
  const toggle = (id: string): HTMLButtonElement => pane(id).querySelector('.pane-toggle') as HTMLButtonElement;

  /** A pane is 100px tall from y = 0; `clientY` picks its half. */
  function drag(type: string, target: HTMLElement, transfer: FakeTransfer, clientY = 0): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  beforeEach(() => {
    for (const element of fixture.nativeElement.querySelectorAll('.ui-pane')) {
      (element as HTMLElement).getBoundingClientRect = () => ({ top: 0, height: 100, bottom: 100 }) as DOMRect;
    }
  });

  it('drags by the header, and reports a drop on the upper or lower half of another pane', () => {
    const transfer = new FakeTransfer();
    expect(header('a').getAttribute('draggable')).toBe('true');

    drag('dragstart', header('a'), transfer);
    expect(transfer.getData(UI_PANE_MIME)).toBe('a');
    expect(pane('a').classList).toContain('is-dragging');

    const over = drag('dragover', pane('c'), transfer, 80);
    expect(over.defaultPrevented).toBe(true);
    expect(pane('c').classList).toContain('drop-after');

    drag('drop', pane('c'), transfer, 80);
    drag('dragend', header('a'), transfer);
    drag('dragstart', header('c'), transfer);
    drag('drop', pane('b'), transfer, 20);

    expect(fixture.componentInstance.moves).toEqual([
      { paneId: 'a', targetId: 'c', position: 'after' },
      { paneId: 'c', targetId: 'b', position: 'before' },
    ]);
    expect(pane('c').classList).not.toContain('drop-after');
  });

  it('takes no drop from itself or from another sidebar', () => {
    const transfer = new FakeTransfer();
    drag('dragstart', header('a'), transfer);
    expect(drag('dragover', pane('a'), transfer).defaultPrevented).toBe(false);
    expect(drag('dragover', pane('other'), transfer).defaultPrevented).toBe(false);
    drag('drop', pane('other'), transfer);
    drag('dragend', header('a'), transfer);

    expect(fixture.componentInstance.moves).toEqual([]);
  });

  it('moves a slot up or down with Ctrl+Arrow on the header, past the pane shown next to it', () => {
    const key = (id: string, key: string) =>
      toggle(id).dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));

    key('b', 'ArrowUp');
    key('b', 'ArrowDown');
    key('a', 'ArrowUp'); // the first has nowhere to go
    expect(fixture.componentInstance.moves).toEqual([
      { paneId: 'b', targetId: 'a', position: 'before' },
      { paneId: 'b', targetId: 'c', position: 'after' },
    ]);
    expect(toggle('b').getAttribute('aria-keyshortcuts')).toBe('Control+ArrowUp Control+ArrowDown');
  });
});

describe('Resizing sidebar panes', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  const pane = (id: string): HTMLElement => fixture.nativeElement.querySelector(`[data-pane-id="${id}"]`) as HTMLElement;
  const sash = (id: string): HTMLElement | null => pane(id).querySelector(':scope > .pane-sash');

  /** Panes a, b and c 100, 200 and 300px tall, each with a 22px header. */
  function measure(): void {
    const heights: Record<string, number> = { a: 100, b: 200, c: 300 };
    for (const [id, height] of Object.entries(heights)) {
      pane(id).getBoundingClientRect = () => ({ height }) as DOMRect;
      (pane(id).querySelector('.pane-header') as HTMLElement).getBoundingClientRect = () => ({ height: 22 }) as DOMRect;
    }
  }

  function pointer(type: string, target: HTMLElement, clientY: number): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, clientY });
    target.dispatchEvent(event);
    fixture.detectChanges();
  }

  it('trades height with the expanded pane above, reporting every expanded pane', () => {
    measure();
    const handle = sash('c') as HTMLElement;
    pointer('pointerdown', handle, 500);
    pointer('pointermove', handle, 450);
    pointer('pointermove', handle, 470);
    pointer('pointerup', handle, 470);

    expect(fixture.componentInstance.resizes).toEqual([
      { sizes: { a: 100, b: 150, c: 350 } },
      { sizes: { a: 100, b: 170, c: 330 } },
    ]);
  });

  it('keeps each pane its header and a row', () => {
    measure();
    const handle = sash('b') as HTMLElement;
    pointer('pointerdown', handle, 100);
    pointer('pointermove', handle, 0);
    expect(fixture.componentInstance.resizes.at(-1)).toEqual({ sizes: { a: 45, b: 255, c: 300 } });
    pointer('pointermove', handle, 1000);
    expect(fixture.componentInstance.resizes.at(-1)).toEqual({ sizes: { a: 255, b: 45, c: 300 } });
  });

  it('resizes across a collapsed pane: the expanded ones either side trade, from either edge', () => {
    fixture.componentInstance.collapsed.set(['b']);
    fixture.detectChanges();
    measure();

    // The edge right under A is the collapsed B's; its header rides along.
    (sash('b') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    (sash('c') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(fixture.componentInstance.resizes).toEqual([{ sizes: { a: 124, c: 276 } }, { sizes: { a: 76, c: 324 } }]);
  });

  it('does nothing on an edge with no expanded pane on one side', () => {
    fixture.componentInstance.collapsed.set(['a', 'c']);
    fixture.detectChanges();
    measure();

    (sash('b') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    (sash('c') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(fixture.componentInstance.resizes).toEqual([]);
  });

  it('weighs a sized pane by its size while expanded', () => {
    fixture.componentInstance.sizes.set({ a: 120, b: 80 });
    fixture.componentInstance.collapsed.set(['b']);
    fixture.detectChanges();

    expect(pane('a').style.flex).toBe('120 1 0px');
    expect(pane('a').classList).toContain('is-sized');
    expect(pane('b').style.flex).toBe('');
    expect(pane('c').style.flex).toBe('');
  });
});
