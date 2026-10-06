import { TestBed } from '@angular/core/testing';
import { UiWorkbenchService } from '@tr-file/ui';
import { App } from './app';
import { appConfig } from './app.config';
import type { DemoWorkbenchService } from './demo-workbench.service';

/** The demo boots on the library alone, and its notes open in the library's panels (PRD 001, §17.1). */
describe('the demo', () => {
  it('opens a note from the Explorer in a panel, and splits it', async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const workbench = TestBed.inject(UiWorkbenchService) as DemoWorkbenchService;

    expect(host.querySelector('[data-focus-region="explorer"] ui-tree')?.textContent).toContain('Shopping');
    workbench.notesFt.open('note-1');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.querySelector('ui-panel-group ui-notes textarea')).not.toBeNull();
    expect(host.querySelector('ui-property-list')?.textContent).toContain('Shopping');

    workbench.editorGroupsFt.runAction(workbench.activeGroupId(), 'split-right');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.querySelectorAll('ui-panel-group').length).toBe(2);
  });
});
