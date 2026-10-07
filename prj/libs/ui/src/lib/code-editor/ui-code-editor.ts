import { Component, computed, effect, inject, input, output, untracked, viewChild, type ElementRef } from '@angular/core';
import type { UiSyntaxLanguage } from './syntax/syntax.model';
import { UI_CODE_LINE_HEIGHT, UiCodeEditorService, type UiCodePosition } from './ui-code-editor.service';

/** A place in the text the editor marks — a JSON syntax error (PRD 005, §5). */
export interface UiCodeProblem {
  /** 1-based. */
  readonly line: number;
  readonly message: string;
}

/** What opens a block, after which `Enter` indents one more step. */
const OPENS_BLOCK = /[{[(]\s*$/;

/**
 * The file editor (PRD 005, §4): a plain `<textarea>`, and laid over it the
 * same text coloured — markdown, bash or JSON — with a gutter of line numbers.
 *
 * The textarea is the editor: typing, the caret, selecting, undo and redo,
 * the clipboard and input methods are all the browser's, and its text is
 * drawn transparent. The overlay above it draws only what is near the view
 * (`UiCodeEditorService`), so it is moved by the textarea's scroll directly,
 * in the scroll handler, rather than on the next render — one frame late, the
 * colours would trail the caret. It takes no pointer: every press lands on
 * the textarea below.
 *
 * Its own keys are an editor's, fixed as a text field's are: `Tab` /
 * `Shift`+`Tab` indent and outdent (the selected lines, when it spans
 * several), `Enter` keeps the line's indentation — one step more after an
 * opening bracket. `Ctrl`+`S` is the application's (a window key), and every
 * other chord passes.
 */
@Component({
  selector: 'ui-code-editor',
  templateUrl: './ui-code-editor.html',
  styleUrl: './ui-code-editor.scss',
  providers: [UiCodeEditorService],
  host: {
    '[class.is-readonly]': 'readonly()',
    '[style.--ui-code-digits]': 'digits()',
  },
})
export class UiCodeEditor {
  /** The text. Replaces what is in the editor only when it differs — typing hands it back unchanged. */
  readonly text = input.required<string>();

  readonly language = input<UiSyntaxLanguage>('plain');

  /** Accessible name of the text area — in practice the file's path. */
  readonly label = input<string>('Editor');

  readonly readonly = input<boolean>(false);

  /** A line to mark in the gutter, and why. */
  readonly problem = input<UiCodeProblem | null>(null);

  /** The text as it is after each change. */
  readonly textChange = output<string>();

  /** Where the caret moved to. */
  readonly caretChange = output<UiCodePosition>();

  protected readonly view = inject(UiCodeEditorService);
  protected readonly lineHeight = UI_CODE_LINE_HEIGHT;

  private readonly areaRef = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');
  private readonly canvasRef = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly gutterRef = viewChild.required<ElementRef<HTMLElement>>('gutter');

  protected readonly digits = computed(() => String(Math.max(2, String(this.view.lineCount()).length)));

  constructor() {
    effect(() => {
      const language = this.language();
      untracked(() => this.view.setLanguage(language));
    });

    // Only a new `text` puts text in: what is typed is reported, and comes back the same.
    effect(() => {
      const text = this.text();
      const area = this.areaRef().nativeElement;
      untracked(() => {
        if (area.value !== text) {
          // Setting the value puts the caret at the end; a file opens at its top, and
          // text replaced under the caret (*Format Document*) keeps it where it was.
          const caret = area.value === '' ? 0 : Math.min(area.selectionStart, text.length);
          area.value = text;
          area.setSelectionRange(caret, caret);
          if (caret === 0) {
            area.scrollTop = 0;
            area.scrollLeft = 0;
            this.onScroll();
          }
        }
        this.view.setText(text);
      });
    });

    effect((onCleanup) => {
      const area = this.areaRef().nativeElement;
      const measure = (): void => this.view.viewportHeight.set(area.clientHeight);
      measure();
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(measure);
      observer.observe(area);
      onCleanup(() => observer.disconnect());
    });

    effect(() => {
      const caret = this.view.caret();
      untracked(() => this.caretChange.emit(caret));
    });
  }

  /** Puts the keyboard in the text — the panel's body asks for it so. */
  focus(): void {
    this.areaRef().nativeElement.focus();
  }

  protected onInput(): void {
    const area = this.areaRef().nativeElement;
    this.view.setText(area.value);
    this.view.moveCaret(area.value, area.selectionStart);
    this.textChange.emit(area.value);
  }

  protected onScroll(): void {
    const area = this.areaRef().nativeElement;
    this.canvasRef().nativeElement.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    this.gutterRef().nativeElement.style.transform = `translateY(${-area.scrollTop}px)`;
    this.view.scrollTop.set(area.scrollTop);
  }

  protected onCaret(): void {
    const area = this.areaRef().nativeElement;
    this.view.moveCaret(area.value, area.selectionDirection === 'backward' ? area.selectionStart : area.selectionEnd);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.readonly() || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
      return;
    }
    if (event.key === 'Tab') {
      this.indent(event.shiftKey);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      this.newline();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** `Enter`: a new line indented as this one is, one step more after an opening bracket. */
  private newline(): void {
    const area = this.areaRef().nativeElement;
    const start = area.value.lastIndexOf('\n', area.selectionStart - 1) + 1;
    const before = area.value.slice(start, area.selectionStart);
    const indent = /^[ \t]*/.exec(before)?.[0] ?? '';
    this.insert(`\n${indent}${OPENS_BLOCK.test(before) ? this.view.indentUnit() : ''}`);
  }

  /** `Tab` / `Shift`+`Tab`: one step in or out — of every selected line when the selection spans lines. */
  private indent(out: boolean): void {
    const area = this.areaRef().nativeElement;
    const { value, selectionStart, selectionEnd } = area;
    const unit = this.view.indentUnit();
    const multiline = value.slice(selectionStart, selectionEnd).includes('\n');
    if (!out && !multiline) {
      this.insert(unit);
      return;
    }
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEnd = value.indexOf('\n', selectionEnd - (selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? 1 : 0));
    const end = lineEnd === -1 ? value.length : lineEnd;
    const lines = value.slice(start, end).split('\n');
    const changed = lines.map((line) => (out ? line.replace(new RegExp(`^(\\t| {1,${unit === '\t' ? 4 : unit.length}})`), '') : line === '' ? line : unit + line));
    area.setSelectionRange(start, end);
    this.insert(changed.join('\n'));
    area.setSelectionRange(start, start + changed.join('\n').length);
  }

  /**
   * Types `text` over the selection as the browser would — so it is one step
   * of the browser's own undo. Where that is not offered, the text is put in
   * directly.
   */
  private insert(text: string): void {
    const area = this.areaRef().nativeElement;
    const typed = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!typed) {
      area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
      this.onInput();
    }
  }
}
