import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { UiCodeEditor } from '../../public-api';

/** PRD 005, §4 — the editor: the text in a textarea, coloured over it, and an editor's keys. */
describe('UiCodeEditor', () => {
  let fixture: ComponentFixture<UiCodeEditor>;
  let changes: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiCodeEditor] }).compileComponents();
    fixture = TestBed.createComponent(UiCodeEditor);
    fixture.componentRef.setInput('text', '{\n  "a": 1\n}');
    fixture.componentRef.setInput('language', 'json');
    changes = [];
    fixture.componentInstance.textChange.subscribe((text) => changes.push(text));
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  const area = (): HTMLTextAreaElement => fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    area().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  it('puts the text in the textarea, and draws it coloured, line by line, with numbers', () => {
    expect(area().value).toBe('{\n  "a": 1\n}');
    const lines = Array.from(fixture.nativeElement.querySelectorAll('.line')) as HTMLElement[];
    expect(lines.map((line) => line.textContent)).toEqual(['{', '  "a": 1', '}']);
    expect(lines[1]?.querySelector('.tok-property')?.textContent).toBe('"a"');
    expect(fixture.nativeElement.querySelectorAll('.number').length).toBe(3);
  });

  it('opens with the caret at the top, not where setting the text left it', () => {
    expect([area().selectionStart, area().selectionEnd]).toEqual([0, 0]);
  });

  it('reports what is typed, and draws it', () => {
    area().value = '{\n  "a": 2\n}';
    area().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(changes).toEqual(['{\n  "a": 2\n}']);
    expect(fixture.nativeElement.querySelector('.tok-number')?.textContent).toBe('2');
  });

  it('indents with the text’s own step on Tab, and keeps the indentation on Enter', () => {
    area().setSelectionRange(10, 10); // the end of `  "a": 1`
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(area().value).toBe('{\n  "a": 1\n  \n}');
    press('Tab');
    expect(area().value).toBe('{\n  "a": 1\n    \n}');
    expect(changes.at(-1)).toBe(area().value);
  });

  it('outdents the selected lines on Shift+Tab, and leaves chords alone', () => {
    area().setSelectionRange(0, area().value.length);
    press('Tab', { shiftKey: true });
    expect(area().value).toBe('{\n"a": 1\n}');
    expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('marks the line of a problem', () => {
    fixture.componentRef.setInput('problem', { line: 2, message: 'Expected ","' });
    fixture.detectChanges();
    const marked = fixture.nativeElement.querySelector('.number.is-problem') as HTMLElement;
    expect(marked.textContent?.trim()).toBe('2');
    expect(marked.title).toBe('Expected ","');
  });
});
