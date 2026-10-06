import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiPanelGroup, type UiPanelGroupModel } from '../../public-api';

/**
 * The panel group's file overlay goes when the drop lands, even on content
 * that takes the drop itself and stops it there — as the file browser does,
 * and as a desktop drag of entries within one panel always is.
 */
@Component({
  imports: [UiPanelGroup],
  template: `
    <ui-panel-group [group]="group" [acceptFiles]="true">
      <div class="content" (drop)="$event.preventDefault(); $event.stopPropagation()"></div>
    </ui-panel-group>
  `,
})
class Host {
  readonly group: UiPanelGroupModel = { id: 'g', tabs: [{ id: 't', label: 'docs', icon: 'folder', active: true }], actions: [] };
}

describe('UiPanelGroup file overlay', () => {
  const drag = (type: string, target: Element): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [], items: [], dropEffect: 'none' },
    });
    target.dispatchEvent(event);
  };

  it('goes when the drop is taken by the content', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const content = fixture.nativeElement.querySelector('.content') as HTMLElement;
    const overlay = (): Element | null => fixture.nativeElement.querySelector('.filedrop');

    drag('dragover', content);
    fixture.detectChanges();
    expect(overlay()).not.toBeNull();

    drag('drop', content);
    fixture.detectChanges();
    expect(overlay()).toBeNull();
  });

  it('goes when the drag ends without a drop', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const content = fixture.nativeElement.querySelector('.content') as HTMLElement;

    drag('dragover', content);
    fixture.detectChanges();
    drag('dragend', content);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.filedrop')).toBeNull();
  });
});
