import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiTitleBar } from '@tr-file/ui';
import type { UiMenuBarItem, UiWindowControl } from '@tr-file/ui';

/**
 * PRD 001, §8.2 — the title bar of a window with no frame of its own: the
 * window's buttons at its end, and its empty space as the drag region.
 */

const MENU: readonly UiMenuBarItem[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
];

const CONTROLS: readonly UiWindowControl[] = [
  { id: 'minimize', label: 'Minimize', icon: 'window-min' },
  { id: 'toggleMaximize', label: 'Maximize', icon: 'window-max' },
  { id: 'close', label: 'Close', icon: 'x', danger: true },
];

describe('UiTitleBar window decorations', () => {
  let fixture: ComponentFixture<UiTitleBar>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTitleBar] }).compileComponents();
    fixture = TestBed.createComponent(UiTitleBar);
    fixture.componentRef.setInput('menuItems', MENU);
    fixture.detectChanges();
    host = fixture.nativeElement;
  });

  const controls = (): HTMLElement[] => Array.from(host.querySelectorAll('.window-btn'));

  const withControls = (): void => {
    fixture.componentRef.setInput('windowControls', CONTROLS);
    fixture.componentRef.setInput('draggable', true);
    fixture.detectChanges();
  };

  /** A browser tab already has all three; drawing more would be nonsense. */
  it('draws no window buttons and no drag region by default', () => {
    expect(controls()).toEqual([]);
    expect(host.classList).not.toContain('is-draggable');
  });

  it('draws the buttons it is handed, in window order and named', () => {
    withControls();

    expect(controls().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Minimize',
      'Maximize',
      'Close',
    ]);
    expect(host.querySelector('.window-controls')?.getAttribute('role')).toBe('toolbar');
  });

  /** Only the close button goes red, as every desktop does it. */
  it('marks the dangerous one', () => {
    withControls();

    expect(controls().map((button) => button.classList.contains('is-danger'))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('reports which button was pressed and acts on nothing itself', () => {
    withControls();
    const pressed: string[] = [];
    fixture.componentInstance.windowControlSelect.subscribe((id) => pressed.push(id));

    controls()[1].click();
    controls()[2].click();

    expect(pressed).toEqual(['toggleMaximize', 'close']);
  });

  it('becomes the drag region only when told to', () => {
    expect(host.classList).not.toContain('is-draggable');

    withControls();

    expect(host.classList).toContain('is-draggable');
  });

  it('leaves room at the leading edge for buttons it does not draw', () => {
    fixture.componentRef.setInput('leadingInset', 78);
    fixture.detectChanges();

    expect(host.style.paddingLeft).toBe('78px');
  });

  describe('double-clicking the bar', () => {
    let toggles: number;

    beforeEach(() => {
      withControls();
      toggles = 0;
      fixture.componentInstance.dragAreaDoubleClick.subscribe(() => (toggles += 1));
    });

    const doubleClick = (target: Element): void => {
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();
    };

    it('is reported when it lands on the bar itself', () => {
      doubleClick(host);

      expect(toggles).toBe(1);
    });

    /** Otherwise double-clicking a menu entry would also maximise the window. */
    it('is ignored when it lands on something interactive', () => {
      doubleClick(host.querySelector('.menu-item') as Element);
      doubleClick(controls()[0]);

      expect(toggles).toBe(0);
    });

    it('is ignored entirely when the bar is not the drag region', () => {
      fixture.componentRef.setInput('draggable', false);
      fixture.detectChanges();

      doubleClick(host);

      expect(toggles).toBe(0);
    });
  });
});
