import { TestBed } from '@angular/core/testing';
import { UiSidebar, type UiIconActionAt } from '@tr-file/ui';

/** PRD 001, §9.2 — the sidebar says where its `…` is, for the menu to open under it. */
describe('UiSidebar', () => {
  it('reports a title action with the button’s place', () => {
    const fixture = TestBed.createComponent(UiSidebar);
    fixture.componentRef.setInput('title', 'Explorer');
    fixture.componentRef.setInput('actions', [{ id: 'more', label: 'More actions', icon: 'dots' }]);
    fixture.detectChanges();

    const selected: string[] = [];
    const at: UiIconActionAt[] = [];
    fixture.componentInstance.actionSelect.subscribe((id) => selected.push(id));
    fixture.componentInstance.actionAt.subscribe((event) => at.push(event));

    const button = fixture.nativeElement.querySelector('.title-actions button') as HTMLButtonElement;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 10, 22, 22));
    button.click();

    expect(selected).toEqual(['more']);
    expect(at).toEqual([{ id: 'more', x: 100, y: 32 }]);
  });
});
