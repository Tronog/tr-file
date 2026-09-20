import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UI_TAB_MIME, UiSash, UiTabBar } from '@tr-file/ui';
import type { UiSashResize, UiTab, UiTabMove, UiTabReorder } from '@tr-file/ui';

const TABS: readonly UiTab[] = [
  { id: 'tab-prj', label: 'prj', icon: 'folder', tint: 'folder', active: true },
  { id: 'tab-frontend', label: 'frontend', icon: 'folder', tint: 'folder' },
  { id: 'tab-notes', label: 'notes.md', icon: 'file', tint: 'md', dirty: true },
];

/**
 * jsdom implements neither `DataTransfer` nor `DragEvent`, so the tests carry
 * the payload on a stand-in with the handful of members the component touches.
 */
class TestDataTransfer {
  private readonly store = new Map<string, string>();

  effectAllowed = 'none';
  dropEffect = 'none';

  get types(): readonly string[] {
    return [...this.store.keys()];
  }

  setData(format: string, data: string): void {
    this.store.set(format, data);
  }

  getData(format: string): string {
    return this.store.get(format) ?? '';
  }
}

/** A drag event of the given type carrying `transfer` as its `dataTransfer`. */
function dragEvent(type: string, transfer: TestDataTransfer | null, clientX = 0): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  return event;
}

describe('UiSash', () => {
  let fixture: ComponentFixture<UiSash>;
  let host: HTMLElement;
  let events: UiSashResize[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSash] }).compileComponents();
    fixture = TestBed.createComponent(UiSash);
    host = fixture.nativeElement;
    // Pointer capture is what keeps moves flowing outside the 8px hit area;
    // jsdom has no implementation, so the sash's guarded calls get stubs.
    host.setPointerCapture = () => undefined;
    host.releasePointerCapture = () => undefined;
    host.hasPointerCapture = () => true;
    events = [];
    fixture.detectChanges();
    fixture.componentInstance.resize.subscribe((event) => events.push(event));
  });

  const pointer = (type: string, coords: { clientX?: number; clientY?: number }): PointerEvent =>
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, ...coords });

  it('reports a pointer drag as start, the travelled delta, then end', () => {
    host.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    host.dispatchEvent(pointer('pointermove', { clientX: 140 }));
    host.dispatchEvent(pointer('pointermove', { clientX: 130 }));
    host.dispatchEvent(pointer('pointerup', { clientX: 130 }));

    expect(events).toEqual([
      { delta: 0, phase: 'start' },
      { delta: 40, phase: 'move' },
      { delta: -10, phase: 'move' },
      { delta: 0, phase: 'end' },
    ]);
  });

  it('ignores moves that belong to no drag of its own', () => {
    host.dispatchEvent(pointer('pointermove', { clientX: 140 }));
    host.dispatchEvent(pointer('pointerup', { clientX: 140 }));

    expect(events).toEqual([]);
  });

  it('follows the vertical axis when the sash separates two rows', () => {
    fixture.componentRef.setInput('orientation', 'horizontal');
    fixture.detectChanges();

    host.dispatchEvent(pointer('pointerdown', { clientY: 200 }));
    host.dispatchEvent(pointer('pointermove', { clientY: 170 }));

    expect(events).toEqual([
      { delta: 0, phase: 'start' },
      { delta: -30, phase: 'move' },
    ]);
  });

  it('turns an arrow key into a step-sized move followed by an end', () => {
    fixture.componentRef.setInput('step', 16);
    fixture.detectChanges();

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    expect(events).toEqual([
      { delta: 16, phase: 'move' },
      { delta: 0, phase: 'end' },
      { delta: -16, phase: 'move' },
      { delta: 0, phase: 'end' },
    ]);
  });

  it('ignores the keys of the other axis', () => {
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toEqual([]);

    fixture.componentRef.setInput('orientation', 'horizontal');
    fixture.detectChanges();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

    expect(events).toEqual([
      { delta: -24, phase: 'move' },
      { delta: 0, phase: 'end' },
    ]);
  });

  it('is a focusable separator', () => {
    expect(host.getAttribute('role')).toBe('separator');
    expect(host.getAttribute('tabindex')).toBe('0');
    expect(host.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('renders the aria value range only once a value is given', () => {
    expect(host.getAttribute('aria-valuenow')).toBeNull();
    expect(host.getAttribute('aria-valuemin')).toBeNull();
    expect(host.getAttribute('aria-valuemax')).toBeNull();

    fixture.componentRef.setInput('value', 280.4);
    fixture.componentRef.setInput('min', 170);
    fixture.componentRef.setInput('max', 600);
    fixture.detectChanges();

    expect(host.getAttribute('aria-valuenow')).toBe('280');
    expect(host.getAttribute('aria-valuemin')).toBe('170');
    expect(host.getAttribute('aria-valuemax')).toBe('600');
  });
});

describe('UiTabBar', () => {
  let fixture: ComponentFixture<UiTabBar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTabBar] }).compileComponents();
    fixture = TestBed.createComponent(UiTabBar);
    fixture.componentRef.setInput('tabs', TABS);
    fixture.componentRef.setInput('groupId', 'group-prj');
    fixture.detectChanges();
  });

  const tabElements = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.tab'));
  const strip = (): HTMLElement => fixture.nativeElement.querySelector('[role="tablist"]');

  /**
   * jsdom lays nothing out, so the strip and its tabs are given 120px-wide
   * boxes — the drop marker is chosen from their midpoints.
   */
  const layOutTabs = (): void => {
    strip().getBoundingClientRect = () => new DOMRect(0, 0, 360, 35);
    tabElements().forEach((tab, index) => {
      tab.getBoundingClientRect = () => new DOMRect(index * 120, 0, 120, 35);
    });
  };

  it('writes the tab and group ids under the tab MIME type on dragstart', () => {
    const transfer = new TestDataTransfer();

    tabElements()[1].dispatchEvent(dragEvent('dragstart', transfer));
    fixture.detectChanges();

    expect(JSON.parse(transfer.getData(UI_TAB_MIME))).toEqual({ tabId: 'tab-frontend', groupId: 'group-prj' });
    expect(transfer.effectAllowed).toBe('move');
    expect(tabElements()[1].classList).toContain('is-dragging');
  });

  it('emits a reorder naming the tab the drop landed in front of', () => {
    const drops: UiTabReorder[] = [];
    fixture.componentInstance.tabDrop.subscribe((drop) => drops.push(drop));
    layOutTabs();
    const transfer = new TestDataTransfer();
    transfer.setData(UI_TAB_MIME, JSON.stringify({ tabId: 'tab-x', groupId: 'group-docs' }));

    // Past the first tab's midpoint but not the second's: insert before tab 2.
    strip().dispatchEvent(dragEvent('drop', transfer, 130));

    expect(drops).toEqual([
      { tabId: 'tab-x', groupId: 'group-docs', targetGroupId: 'group-prj', beforeTabId: 'tab-frontend' },
    ]);
  });

  it('appends when the drop falls past the last tab', () => {
    const drops: UiTabReorder[] = [];
    fixture.componentInstance.tabDrop.subscribe((drop) => drops.push(drop));
    layOutTabs();
    const transfer = new TestDataTransfer();
    transfer.setData(UI_TAB_MIME, JSON.stringify({ tabId: 'tab-x', groupId: 'group-docs' }));

    strip().dispatchEvent(dragEvent('drop', transfer, 350));

    expect(drops[0]?.beforeTabId).toBeNull();
  });

  it('ignores a drop whose payload is missing or malformed', () => {
    const drops: UiTabReorder[] = [];
    fixture.componentInstance.tabDrop.subscribe((drop) => drops.push(drop));
    layOutTabs();
    const malformed = new TestDataTransfer();
    malformed.setData(UI_TAB_MIME, '{ not json');
    const foreign = new TestDataTransfer();
    foreign.setData(UI_TAB_MIME, JSON.stringify({ tabId: 42 }));

    strip().dispatchEvent(dragEvent('drop', new TestDataTransfer(), 10));
    strip().dispatchEvent(dragEvent('drop', malformed, 10));
    strip().dispatchEvent(dragEvent('drop', foreign, 10));
    strip().dispatchEvent(dragEvent('drop', null, 10));

    expect(drops).toEqual([]);
  });

  it('closes a tab on middle click only', () => {
    const closed: string[] = [];
    fixture.componentInstance.close.subscribe((id) => closed.push(id));

    tabElements()[2].dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }));
    tabElements()[2].dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));

    expect(closed).toEqual(['tab-notes']);
  });

  it('selects along the bar with ArrowRight', () => {
    const selected: string[] = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));

    strip().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(selected).toEqual(['tab-frontend']);
  });

  it('moves a tab with Ctrl+ArrowRight instead of selecting', () => {
    const moves: UiTabMove[] = [];
    const selected: string[] = [];
    fixture.componentInstance.tabMove.subscribe((move) => moves.push(move));
    fixture.componentInstance.select.subscribe((id) => selected.push(id));

    strip().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));

    expect(moves).toEqual([{ tabId: 'tab-prj', direction: 1 }]);
    expect(selected).toEqual([]);
  });

  it('closes the focused tab with Delete', () => {
    const closed: string[] = [];
    fixture.componentInstance.close.subscribe((id) => closed.push(id));

    strip().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(closed).toEqual(['tab-prj']);
  });
});
