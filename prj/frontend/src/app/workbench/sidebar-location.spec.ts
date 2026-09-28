import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiActivityBar, UiContextMenu, UiWorkbench } from '@tr-file/ui';
import type { UiSashResize } from '@tr-file/ui';
import { MemorySettingsStore, SettingsService } from '../settings/settings.service';
import { PREFERENCES_KEY } from './features/preferences.feature';
import { WorkbenchService } from './workbench.service';
import { provideOnePanel } from './testing/one-panel';

/**
 * PRD 010, §3 — the Explorer and Details sidebars, each at either side of the
 * window, both at the same one if so chosen.
 */

@Component({
  imports: [UiWorkbench],
  template: `
    <ui-workbench [leftAt]="leftAt()" [rightAt]="rightAt()" (leftResize)="left.push($event)" (rightResize)="right.push($event)">
      <div uiSlot="activity">A</div>
      <div uiSlot="left">E</div>
      <div uiSlot="center">C</div>
      <div uiSlot="right">D</div>
    </ui-workbench>
  `,
})
class ShellHost {
  readonly leftAt = signal<'left' | 'right'>('left');
  readonly rightAt = signal<'left' | 'right'>('right');
  readonly left: UiSashResize[] = [];
  readonly right: UiSashResize[] = [];
}

describe('Sidebar location (PRD 010, §3)', () => {
  describe('UiWorkbench', () => {
    const setUp = () => {
      const fixture = TestBed.createComponent(ShellHost);
      fixture.detectChanges();
      const body = fixture.nativeElement.querySelector('ui-workbench .body') as HTMLElement;
      /** The regions left to right, by their flex order, as the letters their slots hold. */
      const order = (): string =>
        (Array.from(body.children) as HTMLElement[])
          .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0))
          .map((region) => (region.classList.contains('center') ? 'C' : (region.textContent?.trim().charAt(0) ?? '')))
          .join('');
      const sash = (slot: 'left' | 'right') =>
        (fixture.debugElement.children[0]?.componentInstance as { resized(slot: 'left' | 'right', event: UiSashResize): void }).resized(slot, {
          delta: 10,
          phase: 'move',
        });
      return { fixture, body, order, sash };
    };

    it('lays out the activity bar and the Explorer at the left, Details at the right, to start with', () => {
      const { order } = setUp();

      expect(order()).toBe('AECD');
    });

    it('moves each sidebar on its own — both to one side, the left slot outermost beside the activity bar', () => {
      const { fixture, order } = setUp();

      fixture.componentInstance.rightAt.set('left');
      fixture.detectChanges();
      expect(order()).toBe('AEDC');

      fixture.componentInstance.leftAt.set('right');
      fixture.componentInstance.rightAt.set('right');
      fixture.detectChanges();
      expect(order()).toBe('CDEA');

      fixture.componentInstance.rightAt.set('left');
      fixture.detectChanges();
      expect(order()).toBe('DCEA');
    });

    it('puts each sash on the edge its sidebar faces the centre with', () => {
      const { fixture, body } = setUp();
      fixture.componentInstance.rightAt.set('left');
      fixture.detectChanges();

      const sidebars = Array.from(body.querySelectorAll(':scope > .sidebar')) as HTMLElement[];
      expect(sidebars.every((sidebar) => sidebar.classList.contains('at-left') && sidebar.querySelector(':scope > ui-sash') !== null)).toBe(true);
    });

    it('reports a sash step as if the sidebar were at the edge its slot is named for', () => {
      const { fixture, sash } = setUp();
      sash('left');
      sash('right');

      fixture.componentInstance.leftAt.set('right');
      fixture.componentInstance.rightAt.set('left');
      fixture.detectChanges();
      sash('left');
      sash('right');

      expect(fixture.componentInstance.left.map((step) => step.delta)).toEqual([10, -10]);
      expect(fixture.componentInstance.right.map((step) => step.delta)).toEqual([10, -10]);
    });
  });

  it('UiActivityBar draws its border and indicator on the other edge on the right', () => {
    const fixture = TestBed.createComponent(UiActivityBar);
    fixture.componentRef.setInput('items', [{ id: 'explorer', label: 'Explorer', icon: 'copy', active: true }]);
    fixture.componentRef.setInput('side', 'right');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).classList.contains('side-right')).toBe(true);
  });

  it('UiContextMenu opening from its bottom-right corner puts that corner at the point', () => {
    const fixture = TestBed.createComponent(UiContextMenu);
    fixture.componentRef.setInput('items', [{ id: 'a', label: 'A' }]);
    fixture.componentRef.setInput('fixed', true);
    fixture.componentRef.setInput('origin', 'bottom-right');
    fixture.componentRef.setInput('x', 900);
    const host = fixture.nativeElement as HTMLElement;
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 600, 180, 60));
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();

    expect(host.style.left).toBe('720px');
    expect(host.classList.contains('from-bottom')).toBe(true);
  });

  describe('the settings', () => {
    let workbench: WorkbenchService;
    let store: MemorySettingsStore;

    beforeEach(() => {
      store = new MemorySettingsStore();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel(), { provide: SettingsService, useValue: store }],
      });
      workbench = TestBed.inject(WorkbenchService);
    });

    const preferences = () => workbench.preferencesFt;

    it('puts the Explorer on the left and Details on the right to start with', () => {
      expect(preferences().explorerSide()).toBe('left');
      expect(preferences().detailsSide()).toBe('right');
    });

    it('moves each on its own — both may be on one side — and remembers only a change', () => {
      preferences().choose('workbench.detailsLocation', 'left');
      expect(preferences().explorerSide()).toBe('left');
      expect(preferences().detailsSide()).toBe('left');
      expect(store.get(PREFERENCES_KEY)).toEqual({ 'workbench.detailsLocation': 'left' });

      preferences().choose('workbench.explorerLocation', 'right');
      preferences().choose('workbench.detailsLocation', 'right');
      expect(preferences().explorerSide()).toBe('right');
      expect(preferences().detailsSide()).toBe('right');
      expect(store.get(PREFERENCES_KEY)).toEqual({ 'workbench.explorerLocation': 'right' });
    });

    it('ignores a side that is not one, and resets to the default', () => {
      preferences().choose('workbench.explorerLocation', 'top');
      expect(preferences().explorerSide()).toBe('left');

      preferences().choose('workbench.detailsLocation', 'left');
      expect(preferences().isModified('workbench.detailsLocation')).toBe(true);
      preferences().reset('workbench.detailsLocation');
      expect(preferences().detailsSide()).toBe('right');
    });

    it('shows both as drop-downs on the Appearance page, and changes them from there', () => {
      const editor = workbench.settingsEditorFt;
      editor.open('appearance');
      const page = editor.model().page;
      const settings = page.kind === 'settings' ? page.groups.flatMap((group) => group.settings) : [];

      expect(settings.find((setting) => setting.id === 'workbench.explorerLocation')?.control).toEqual({
        kind: 'select',
        value: 'left',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      });

      editor.changeSetting({ id: 'workbench.detailsLocation', value: 'left' });
      expect(preferences().detailsSide()).toBe('left');
      expect(preferences().explorerSide()).toBe('left');
    });

    it('walks Ctrl+Tab left to right as the window shows it', () => {
      const group = `group:${workbench.activeGroupId()}`;
      expect(workbench.focusCycleFt.ring()).toEqual(['explorer', group, 'details']);

      preferences().choose('workbench.detailsLocation', 'left');
      expect(workbench.focusCycleFt.ring()).toEqual(['explorer', 'details', group]);

      preferences().choose('workbench.explorerLocation', 'right');
      preferences().choose('workbench.detailsLocation', 'right');
      expect(workbench.focusCycleFt.ring()).toEqual([group, 'details', 'explorer']);
    });

    it('opens the gear menu leftward from the gear when the activity bar is on the right', () => {
      const anchor = { id: 'settings', left: 1232, top: 700, right: 1280, bottom: 748 };
      workbench.chromeFt.openMenu(anchor);
      expect(workbench.chromeFt.settingsMenu()).toEqual({ x: 1280, y: 748 });
      workbench.chromeFt.closeSettingsMenu();

      preferences().choose('workbench.explorerLocation', 'right');
      workbench.chromeFt.openMenu(anchor);
      expect(workbench.chromeFt.settingsMenu()).toEqual({ x: 1232, y: 748, leftward: true });
    });
  });
});
