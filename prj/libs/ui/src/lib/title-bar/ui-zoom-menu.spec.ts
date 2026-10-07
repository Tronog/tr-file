import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UiTitleBar, type UiTitleBarZoom, type UiZoomRequest } from '../../public-api';

/** PRD 001, §8.2.3 — the title bar's zoom button and its dropdown: out, in, 100 %, a slider. */
@Component({
  imports: [UiTitleBar],
  template: `<ui-title-bar [menuItems]="[]" [zoom]="zoom()" (zoomRequest)="requests.push($event)" /><button class="outside">x</button>`,
})
class Host {
  readonly zoom = signal<UiTitleBarZoom | null>({ percent: 100, min: 50, max: 300 });
  readonly requests: UiZoomRequest[] = [];
}

describe('The title bar’s zoom control', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const query = <T extends Element>(selector: string): T | null => fixture.nativeElement.querySelector(selector) as T | null;
  const button = (): HTMLButtonElement => query<HTMLButtonElement>('.zoom-btn') as HTMLButtonElement;
  const open = async (): Promise<void> => {
    button().click();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('is drawn only when there is a zoom to control', () => {
    expect(button()).not.toBeNull();
    fixture.componentInstance.zoom.set(null);
    fixture.detectChanges();
    expect(query('.zoom-btn')).toBeNull();
  });

  it('says its level when it is not 100 %', () => {
    expect(query('.zoom-percent')).toBeNull();
    fixture.componentInstance.zoom.set({ percent: 125, min: 50, max: 300 });
    fixture.detectChanges();
    expect(query('.zoom-percent')?.textContent?.trim()).toBe('125%');
    expect(button().getAttribute('aria-label')).toBe('Zoom (125%)');
  });

  it('drops down out, in, 100 % and a slider that has the keyboard, and reports each', async () => {
    await open();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    const slider = query<HTMLInputElement>('ui-zoom-menu input[type="range"]') as HTMLInputElement;
    expect(document.activeElement).toBe(slider);
    expect(query<HTMLButtonElement>('.zoom-reset')?.disabled).toBe(true);

    (query('[aria-label="Zoom In"]') as HTMLButtonElement).click();
    (query('[aria-label="Zoom Out"]') as HTMLButtonElement).click();

    // Dragged: the level shown follows the thumb; it is applied when let go of.
    slider.value = '150';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(query('.zoom-value')?.textContent?.trim()).toBe('150%');
    expect(fixture.componentInstance.requests).toHaveLength(2);
    slider.dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.requests).toEqual([{ kind: 'in' }, { kind: 'out' }, { kind: 'set', percent: 150 }]);
  });

  it('closes on Escape, giving the keyboard back to its button, and on a press outside', async () => {
    await open();
    query('ui-zoom-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(query('ui-zoom-menu')).toBeNull();
    expect(document.activeElement).toBe(button());

    await open();
    query('.outside')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(query('ui-zoom-menu')).toBeNull();

    // The button toggles it itself.
    await open();
    button().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button().click();
    fixture.detectChanges();
    expect(query('ui-zoom-menu')).toBeNull();
  });
});
