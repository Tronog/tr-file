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

  it('keeps the caret in view on Enter at the end of the text', () => {
    let scrollTop = 0;
    Object.defineProperty(area(), 'clientHeight', { configurable: true, get: () => 60 });
    Object.defineProperty(area(), 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => (scrollTop = value) });
    area().setSelectionRange(area().value.length, area().value.length);
    press('Enter');
    press('Enter');

    // Caret on line 5: its bottom (5 × 19) and the padding (2 × 4) inside the 60px view.
    expect(area().value).toBe('{\n  "a": 1\n}\n\n');
    expect(scrollTop).toBe(5 * 19 + 8 - 60);
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

  /** tr-prd PRD 005, §1.2 — blocks fold and open; the textarea holds what is in view, the editor the whole text. */
  describe('folds', () => {
    const text = '{\n  "a": {\n    "b": 1\n  }\n}';

    beforeEach(() => {
      fixture.componentRef.setInput('text', text);
      fixture.detectChanges();
    });

    const numbers = (): string[] => Array.from(fixture.nativeElement.querySelectorAll('.number')).map((number) => (number as HTMLElement).textContent?.trim() ?? '');
    const chevron = (line: number): HTMLElement => fixture.nativeElement.querySelectorAll('.number')[line].querySelector('.fold') as HTMLElement;
    const fold = (line: number): void => {
      chevron(line).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    const type = (value: string): void => {
      area().setRangeText(value, area().selectionStart, area().selectionEnd, 'end');
      area().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    it('folds a block from its chevron, and opens it from the ⋯ it leaves', () => {
      expect(numbers().map((_, line) => !!chevron(line))).toEqual([true, true, false, false, false]);
      fold(1);

      expect(area().value).toBe('{\n  "a": {\n  }\n}');
      expect(numbers()).toEqual(['1', '2', '4', '5']);
      expect(chevron(1).classList).toContain('is-folded');
      const lines = Array.from(fixture.nativeElement.querySelectorAll('.line')) as HTMLElement[];
      expect(lines.map((line) => line.textContent)).toEqual(['{', '  "a": {⋯', '  }', '}']);

      (fixture.nativeElement.querySelector('.folded') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(area().value).toBe(text);
      expect(numbers()).toEqual(['1', '2', '3', '4', '5']);
    });

    it('reports the whole text as it is typed into, folded — Enter at a folded line opening a line after the block', () => {
      fold(1);
      area().setSelectionRange(10, 10); // the end of `  "a": {`
      type(' ');
      expect(changes.at(-1)).toBe('{\n  "a": { \n    "b": 1\n  }\n}');

      press('Enter');
      expect(changes.at(-1)).toBe('{\n  "a": { \n    "b": 1\n    \n  }\n}');
      expect(area().value).toBe('{\n  "a": { \n    \n  }\n}');
      expect(numbers()).toEqual(['1', '2', '4', '5', '6']);
      expect(fixture.componentInstance['view'].caret()).toEqual({ line: 4, column: 5 });
    });

    it('opens a block before a selection across it, or Backspace at its edge, can take its lines', () => {
      fold(1);
      area().setSelectionRange(5, 13);
      area().dispatchEvent(new Event('select'));
      expect(area().value).toBe(text);
      expect(area().value.slice(area().selectionStart, area().selectionEnd)).toBe('a": {\n    "b": 1\n  ');

      fold(1);
      area().setSelectionRange(11, 11); // the start of `  }`
      press('Backspace');
      expect(area().value).toBe(text);
      expect(area().selectionStart).toBe(22);
    });

    it('folds the innermost block at the caret on Ctrl+Shift+[, and opens it on Ctrl+Shift+] — read-only too', () => {
      fixture.componentRef.setInput('readonly', true);
      fixture.detectChanges();
      area().setSelectionRange(16, 16); // in `    "b": 1`
      area().dispatchEvent(new Event('click'));
      expect(press('{', { ctrlKey: true, shiftKey: true, code: 'BracketLeft' }).defaultPrevented).toBe(true);
      expect(area().value).toBe('{\n  "a": {\n  }\n}');
      expect(area().selectionStart).toBe(10);

      press('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' });
      expect(area().value).toBe(text);
    });

    it('opens a block find goes to a match in', () => {
      fold(0);
      expect(area().value).toBe('{\n}');
      press('f', { ctrlKey: true });
      const field = fixture.nativeElement.querySelector('.find input') as HTMLInputElement;
      field.value = '"b"';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      fixture.detectChanges();

      expect(area().value).toBe(text);
      expect(area().value.slice(area().selectionStart, area().selectionEnd)).toBe('"b"');
    });

    it('drops the folds when another text comes in', () => {
      fold(1);
      fixture.componentRef.setInput('text', '[\n  1\n]');
      fixture.detectChanges();
      expect(area().value).toBe('[\n  1\n]');
      expect(numbers()).toEqual(['1', '2', '3']);
    });
  });

  /** PRD 005, §5.1 — find in the text, which the browser's own cannot see. */
  describe('find', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('text', '{\n  "alpha": 1,\n  "beta": "Alpha"\n}');
      fixture.detectChanges();
    });

    const field = (): HTMLInputElement => fixture.nativeElement.querySelector('.find input') as HTMLInputElement;
    const query = (text: string): void => {
      field().value = text;
      field().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const count = (): string => (fixture.nativeElement.querySelector('.find-count') as HTMLElement).textContent?.trim() ?? '';

    it('opens on Ctrl+F with the selection as its query, and marks every match, case ignored', () => {
      area().setSelectionRange(5, 10); // alpha
      expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(true);
      fixture.detectChanges();

      expect(field().value).toBe('alpha');
      expect(count()).toBe('2 found');
      expect(Array.from(fixture.nativeElement.querySelectorAll('.is-match')).map((mark) => (mark as HTMLElement).textContent)).toEqual(['alpha', 'Alpha']);
    });

    it('selects the next and the previous match on Enter / Shift+Enter, round at either end', () => {
      press('f', { ctrlKey: true });
      query('ALPHA');
      const enter = (shiftKey = false): void => {
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }));
        fixture.detectChanges();
      };
      enter();
      expect(count()).toBe('1 of 2');
      expect(area().value.slice(area().selectionStart, area().selectionEnd)).toBe('alpha');
      enter();
      expect(area().value.slice(area().selectionStart, area().selectionEnd)).toBe('Alpha');
      expect(fixture.nativeElement.querySelector('.line .is-current')?.textContent).toBe('Alpha');
      enter(true);
      expect(count()).toBe('1 of 2');
    });

    it('closes on Escape, the text taking the keyboard and its marks gone', () => {
      press('f', { ctrlKey: true });
      query('beta');
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.find')).toBeNull();
      expect(fixture.nativeElement.querySelector('.is-match')).toBeNull();
      expect(document.activeElement).toBe(area());
    });
  });
});
