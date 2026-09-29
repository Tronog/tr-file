import { TestBed } from '@angular/core/testing';
import { UiNotes } from '@tr-file/ui';

/** PRD 001, §12.2 — the Notes tab's box. */
describe('UiNotes', () => {
  const create = (text = 'hello') => {
    const fixture = TestBed.createComponent(UiNotes);
    fixture.componentRef.setInput('text', text);
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    return { fixture, box };
  };

  it('shows the text and reports edits and leaving the box', () => {
    const { fixture, box } = create();
    expect(box.value).toBe('hello');

    const edits: string[] = [];
    let commits = 0;
    fixture.componentInstance.textChange.subscribe((text) => edits.push(text));
    fixture.componentInstance.commit.subscribe(() => commits++);

    box.value = 'hello world';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new Event('blur'));
    expect(edits).toEqual(['hello world']);
    expect(commits).toBe(1);
  });

  it('shows an error under the box', () => {
    const { fixture, box } = create();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

    fixture.componentRef.setInput('error', 'Too long');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Too long');
    expect(box.getAttribute('aria-invalid')).toBe('true');
  });
});
