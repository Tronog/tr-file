import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiBottomPanel, type UiPanelTab } from '@tr-file/ui';

/** PRD 001, §12.3 — the keyboard goes into the tab's content as the panel opens. */
@Component({
  imports: [UiBottomPanel],
  template: `
    <ui-bottom-panel [tabs]="tabs" [collapsed]="collapsed()" [bodyFocus]="focus()" (tabSelect)="chosen.push($event)">
      @if (withBox()) {
        <textarea></textarea>
      } @else {
        <p>Nothing here.</p>
      }
    </ui-bottom-panel>
  `,
})
class Host {
  readonly tabs: readonly UiPanelTab[] = [{ id: 'notes', label: 'Notes', active: true }];
  readonly collapsed = signal(true);
  readonly focus = signal(0);
  readonly withBox = signal(true);
  readonly chosen: unknown[] = [];
}

describe('UiBottomPanel bodyFocus', () => {
  const create = () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  };

  afterEach(() => document.body.replaceChildren());

  it('reports a clicked tab, and not text selected in the content', () => {
    const fixture = create();
    fixture.componentInstance.collapsed.set(false);
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'some notes';
    box.setSelectionRange(0, 4);
    box.dispatchEvent(new Event('select', { bubbles: true }));
    (fixture.nativeElement.querySelector('.panel-tab') as HTMLButtonElement).click();

    expect(fixture.componentInstance.chosen).toEqual(['notes']);
  });

  it('focuses the first focusable element of the content once the body is there', async () => {
    const fixture = create();
    fixture.componentInstance.collapsed.set(false);
    fixture.componentInstance.focus.set(1);
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('textarea'));
  });

  it('focuses the body itself when the content has nothing focusable', async () => {
    const fixture = create();
    fixture.componentInstance.withBox.set(false);
    fixture.componentInstance.collapsed.set(false);
    fixture.componentInstance.focus.set(1);
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.panel-body'));
  });

  it('keeps a request made while collapsed until the body renders, and answers it once', async () => {
    const fixture = create();
    fixture.componentInstance.focus.set(1);
    await fixture.whenStable();
    expect(document.activeElement).toBe(document.body);

    fixture.componentInstance.collapsed.set(false);
    await fixture.whenStable();
    const box = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);

    box.blur();
    fixture.componentInstance.withBox.set(false);
    await fixture.whenStable();
    expect(document.activeElement).toBe(document.body);
  });
});
