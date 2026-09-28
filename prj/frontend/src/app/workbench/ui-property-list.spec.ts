import { TestBed } from '@angular/core/testing';
import { UiPropertyList } from '@tr-file/ui';

/** The details' label/value table — and a value that is a button: `1000+ items` (PRD 004, §3.1.3). */
describe('UiPropertyList', () => {
  it('draws a value with an action as a button that reports it', () => {
    const fixture = TestBed.createComponent(UiPropertyList);
    fixture.componentRef.setInput('properties', [
      { label: 'Size', value: '4 KB' },
      { label: 'Entries', value: '1000+ items', action: 'count-entries', actionLabel: 'Count all entries' },
    ]);
    fixture.detectChanges();
    const pressed: string[] = [];
    fixture.componentInstance.action.subscribe((id) => pressed.push(id));

    const buttons = fixture.nativeElement.querySelectorAll('dd button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('1000+ items');
    expect(button.getAttribute('title')).toBe('Count all entries');
    button.click();
    expect(pressed).toEqual(['count-entries']);
    expect(fixture.nativeElement.querySelector('dd')?.textContent?.trim()).toBe('4 KB');
  });
});
