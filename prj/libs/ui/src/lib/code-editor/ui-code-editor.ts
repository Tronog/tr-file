import { Component, computed, effect, inject, input, output, signal, untracked, viewChild, type ElementRef } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiSearchField } from '../controls/ui-search-field';
import type { UiSyntaxLanguage } from './syntax/syntax.model';
import { UI_CODE_LINE_HEIGHT, UiCodeEditorService, type UiCodeMatch, type UiCodePosition } from './ui-code-editor.service';

/** A character's width in the editor's font, when the font cannot be measured (a test). */
const FALLBACK_CHAR_WIDTH = 7.8;

/** How many columns a tab takes — the editor's `tab-size`. */
const TAB_SIZE = 4;

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
 *
 * Find (PRD 005, §5.1) — the browser's own cannot see text drawn this way:
 * `Ctrl`+`F` opens a bar over the text with the selection as its query; every
 * match is marked, `Enter` / `Shift`+`Enter` (`F3` / `Shift`+`F3` in the text)
 * select the next or previous one, `Escape` closes it and gives the text the
 * keyboard with the match selected.
 */
@Component({
  selector: 'ui-code-editor',
  imports: [UiIconButton, UiSearchField],
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

  /** The find bar is open; bump `findFocus` to put the keyboard in it. */
  protected readonly finding = signal(false);
  protected readonly findFocus = signal(0);

  /** `3 of 12`, `No results`, or nothing while nothing is looked for. */
  protected readonly findLabel = computed(() => {
    const total = this.view.matches().length;
    if (this.view.findQuery() === '') {
      return '';
    }
    if (total === 0) {
      return 'No results';
    }
    const index = this.view.findIndex();
    return index < 0 ? `${total >= 10_000 ? '10000+' : total} found` : `${index + 1} of ${total >= 10_000 ? '10000+' : total}`;
  });

  private charWidth: number | null = null;

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
    if (this.onFindKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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

  /* -- find (PRD 005, §5.1) ------------------------------------------------ */

  /** The find keys in the text: `Ctrl`+`F`, `F3` / `Shift`+`F3`, `Escape` while the bar is open. */
  private onFindKey(event: KeyboardEvent): boolean {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      this.openFind();
      return true;
    }
    if (event.key === 'F3' && !ctrl && !event.altKey && this.view.findQuery() !== '') {
      this.findStep(event.shiftKey ? -1 : 1, false);
      return true;
    }
    if (event.key === 'Escape' && this.finding()) {
      this.closeFind();
      return true;
    }
    return false;
  }

  /** Opens the bar — with the selected text as the query, when it is one line — and puts the keyboard in it. */
  protected openFind(): void {
    const area = this.areaRef().nativeElement;
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    if (selected !== '' && !selected.includes('\n')) {
      this.view.findQuery.set(selected);
      this.view.findIndex.set(-1);
    }
    this.finding.set(true);
    this.findFocus.update((token) => token + 1);
  }

  protected closeFind(): void {
    this.finding.set(false);
    this.view.findQuery.set('');
    this.view.findIndex.set(-1);
    this.focus();
  }

  protected onFindQuery(query: string): void {
    this.view.findQuery.set(query);
    this.view.findIndex.set(-1);
  }

  /** In the bar: `Enter` / `Shift`+`Enter` (and `F3`) to the next or previous match, `Escape` back to the text. */
  protected onFindKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'F3') {
      this.findStep(event.shiftKey ? -1 : 1, false);
    } else if (event.key === 'Escape') {
      this.closeFind();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Selects the next match — after the caret, the first time — or the one
   * before, round at either end, and scrolls it into view. The text keeps
   * the keyboard where it had it; `refocus` gives it the text.
   */
  protected findStep(direction: 1 | -1, refocus = false): void {
    const matches = this.view.matches();
    if (matches.length === 0) {
      return;
    }
    const area = this.areaRef().nativeElement;
    let index = this.view.findIndex();
    if (index < 0) {
      const caret = direction === 1 ? area.selectionEnd : area.selectionStart;
      const after = matches.findIndex((match) => this.view.offsetOf(match.line, match.start) >= caret);
      index = direction === 1 ? (after === -1 ? 0 : after) : (after === -1 ? matches.length : after) - 1;
    } else {
      index += direction;
    }
    index = (index + matches.length) % matches.length;
    this.view.findIndex.set(index);
    this.select(matches[index] as UiCodeMatch);
    if (refocus) {
      this.focus();
    }
  }

  /** A match selected in the text, and in view: its line near the middle, its columns on screen. */
  private select(match: UiCodeMatch): void {
    const area = this.areaRef().nativeElement;
    const start = this.view.offsetOf(match.line, match.start);
    area.setSelectionRange(start, start + (match.end - match.start));
    const top = match.line * UI_CODE_LINE_HEIGHT;
    if (top < area.scrollTop || top + UI_CODE_LINE_HEIGHT > area.scrollTop + area.clientHeight) {
      area.scrollTop = Math.max(0, top - area.clientHeight / 2);
    }
    const text = this.view.lineText(match.line);
    const columns = (to: number): number => [...text.slice(0, to)].reduce((column, char) => (char === '\t' ? column + TAB_SIZE - (column % TAB_SIZE) : column + 1), 0);
    const width = this.measureChar();
    const left = columns(match.start) * width;
    const right = columns(match.end) * width;
    if (left < area.scrollLeft) {
      area.scrollLeft = Math.max(0, left - 40);
    } else if (area.clientWidth > 0 && right > area.scrollLeft + area.clientWidth - 40) {
      area.scrollLeft = right - area.clientWidth + 80;
    }
    this.onScroll();
    this.view.moveCaret(area.value, start);
  }

  /** One character's width in the editor's monospace font, measured once. */
  private measureChar(): number {
    if (this.charWidth === null) {
      const context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext?.('2d');
      if (context) {
        context.font = getComputedStyle(this.areaRef().nativeElement).font;
        this.charWidth = context.measureText('0'.repeat(100)).width / 100 || FALLBACK_CHAR_WIDTH;
      } else {
        this.charWidth = FALLBACK_CHAR_WIDTH;
      }
    }
    return this.charWidth;
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
