import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiDocumentView } from '../../public-api';

/** PRD 005, §3 — the text of a file in the viewer can be selected and copied. */
describe('UiDocumentView', () => {
  let fixture: ComponentFixture<UiDocumentView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiDocumentView] }).compileComponents();
    fixture = TestBed.createComponent(UiDocumentView);
    fixture.componentRef.setInput('document', { path: 'notes/a.txt', kind: 'text', text: 'first line\nsecond line' });
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    fixture.nativeElement.remove();
  });

  const doc = (): HTMLElement => fixture.nativeElement.querySelector('.doc') as HTMLElement;
  const press = (init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    doc().dispatchEvent(event);
    return event;
  };

  it('selects the document, and nothing else, on Ctrl+A', () => {
    expect(press({ key: 'a', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toBe('first line\nsecond line');
  });

  it('leaves other keys and chords alone', () => {
    expect(press({ key: 'a' }).defaultPrevented).toBe(false);
    expect(press({ key: 'A', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ key: 'c', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.getSelection()?.toString()).toBe('');
  });
});
