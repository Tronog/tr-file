import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UI_PANE_MIME, UiPane, UiSidebar, type UiPaneMove } from '@tr-file/ui';
import { SidebarPanesFeature } from './features/sidebar-panes.feature';

/** PRD 002, §5.1 — the panes of a sidebar move by drag and drop, and by `Ctrl`+`↑`/`↓`. */

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
        <ui-pane [paneId]="id" [title]="id" (paneMove)="moves.push($event)" />
      }
    </ui-sidebar>
    <ui-sidebar title="Right">
      <ui-pane paneId="other" title="other" (paneMove)="moves.push($event)" />
    </ui-sidebar>
  `,
})
class Host {
  readonly order = signal(['a', 'b', 'c']);
  readonly moves: UiPaneMove[] = [];
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

describe('SidebarPanesFeature order', () => {
  it('places a moved pane before or after its target, in its own sidebar only', () => {
    const panes = new SidebarPanesFeature({ fileSystem: { transport: { systemShell: false } } } as never);
    expect(panes.order('details')).toEqual(['git', 'properties', 'permissions', 'open-with']);

    panes.move('details', { paneId: 'git', targetId: 'open-with', position: 'after' });
    expect(panes.order('details')).toEqual(['properties', 'permissions', 'open-with', 'git']);
    expect(panes.detailsCardBefore()).toBe('properties');

    panes.move('details', { paneId: 'open-with', targetId: 'properties', position: 'before' });
    expect(panes.order('details')).toEqual(['open-with', 'properties', 'permissions', 'git']);

    // An id of the other sidebar changes nothing.
    panes.move('details', { paneId: 'places', targetId: 'git', position: 'before' });
    expect(panes.order('details')).toEqual(['open-with', 'properties', 'permissions', 'git']);
    expect(panes.order('explorer')).toEqual(['places', 'bookmarks', 'recent', 'explorer-tree']);
    expect(panes.changedOrders()).toEqual({ details: ['open-with', 'properties', 'permissions', 'git'] });
  });
});
