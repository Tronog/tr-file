import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiActivityBar, UiContextMenu, UiWorkbench } from '@tr-file/ui';
import type { UiSashResize } from '@tr-file/ui';
import { MemorySettingsStore, SettingsService } from '../settings/settings.service';
import { PREFERENCES_KEY } from './features/preferences.feature';
import { WorkbenchService } from './workbench.service';

/** PRD 010, §3 — the Explorer and Details sidebars, on either side of the window. */

@Component({
  imports: [UiWorkbench],
  template: `
    <ui-workbench [mirrored]="mirrored()" (leftResize)="left.push($event)" (rightResize)="right.push($event)">
      <div uiSlot="activity" class="activity">A</div>
      <div uiSlot="left" class="explorer">E</div>
      <div uiSlot="center" class="centre">C</div>
      <div uiSlot="right" class="details">D</div>
    </ui-workbench>
  `,
})
class ShellHost {
  readonly mirrored = signal(false);
  readonly left: UiSashResize[] = [];
  readonly right: UiSashResize[] = [];
}

describe('Sidebar location (PRD 010, §3)', () => {
  describe('UiWorkbench', () => {
    it('swaps the sides when mirrored, and turns the sashes round so a wider sidebar is still a wider sidebar', () => {
      const fixture = TestBed.createComponent(ShellHost);
      fixture.detectChanges();
      const shell = fixture.nativeElement.querySelector('ui-workbench') as HTMLElement;
      const sashes = () => Array.from(shell.querySelectorAll('ui-sash')) as HTMLElement[];
      expect(shell.classList.contains('is-mirrored')).toBe(false);
      expect(sashes()[0]?.getAttribute('aria-label') ?? sashes()[0]?.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('left');

      fixture.componentInstance.mirrored.set(true);
      fixture.detectChanges();
      expect(shell.classList.contains('is-mirrored')).toBe(true);

      const workbench = fixture.debugElement.children[0]?.componentInstance as UiWorkbench;
      (workbench as unknown as { resized(side: 'left' | 'right', event: UiSashResize): void }).resized('left', { delta: 10, phase: 'move' });
      (workbench as unknown as { resized(side: 'left' | 'right', event: UiSashResize): void }).resized('right', { delta: -4, phase: 'move' });

      expect(fixture.componentInstance.left).toEqual([{ delta: -10, phase: 'move' }]);
      expect(fixture.componentInstance.right).toEqual([{ delta: 4, phase: 'move' }]);
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
        providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SettingsService, useValue: store }],
      });
      workbench = TestBed.inject(WorkbenchService);
    });

    const preferences = () => workbench.preferencesFt;

    it('puts the Explorer on the left and Details on the right to start with', () => {
      expect(preferences().choice('workbench.explorerLocation')).toBe('left');
      expect(preferences().choice('workbench.detailsLocation')).toBe('right');
      expect(preferences().sidesSwapped()).toBe(false);
    });

    it('moves the other sidebar when one moves, and remembers only a change', () => {
      preferences().choose('workbench.explorerLocation', 'right');
      expect(preferences().choice('workbench.detailsLocation')).toBe('left');
      expect(preferences().sidesSwapped()).toBe(true);
      expect(store.get(PREFERENCES_KEY)).toEqual({ 'workbench.explorerLocation': 'right' });

      preferences().choose('workbench.detailsLocation', 'right');
      expect(preferences().choice('workbench.explorerLocation')).toBe('left');
      expect(store.get(PREFERENCES_KEY)).toBeUndefined();
    });

    it('ignores a side that is not one, and resets to the default', () => {
      preferences().choose('workbench.explorerLocation', 'top');
      expect(preferences().choice('workbench.explorerLocation')).toBe('left');

      preferences().choose('workbench.detailsLocation', 'left');
      expect(preferences().isModified('workbench.detailsLocation')).toBe(true);
      preferences().reset('workbench.detailsLocation');
      expect(preferences().sidesSwapped()).toBe(false);
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
      expect(preferences().sidesSwapped()).toBe(true);
    });

    it('walks Ctrl+Tab left to right as the window shows it', () => {
      const group = `group:${workbench.activeGroupId()}`;
      expect(workbench.focusCycleFt.ring()).toEqual(['explorer', group, 'details']);

      preferences().choose('workbench.explorerLocation', 'right');
      expect(workbench.focusCycleFt.ring()).toEqual(['details', group, 'explorer']);
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
