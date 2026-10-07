import { Service, computed, signal } from '@angular/core';
import { visibleRange } from '../virtual/ui-virtual-viewport';
import { UiSyntaxHighlighter } from './syntax/syntax-highlighter';
import type { UiSyntaxLanguage, UiSyntaxToken } from './syntax/syntax.model';

/** Height of one line, in CSS pixels — fixed, so where a line is needs no measuring. */
export const UI_CODE_LINE_HEIGHT = 19;

/** Space above the first line, as the textarea pads it. */
export const UI_CODE_PADDING_TOP = 4;

/** One line on screen: its index, and its coloured runs. */
export interface UiCodeLine {
  readonly index: number;
  readonly tokens: readonly UiSyntaxToken[];
}

/** Where the caret is, 1-based as an editor's status line says it. */
export interface UiCodePosition {
  readonly line: number;
  readonly column: number;
}

/**
 * The code editor's model (PRD 005, §4): the text as lines, where the view is
 * scrolled to, and the coloured lines on screen.
 *
 * Provided by `UiCodeEditor` itself, one per editor, as `UiImageViewService`
 * is per viewer. The text itself lives in the `<textarea>` — its undo, its
 * selection, its clipboard and input methods are the browser's — and is
 * handed here on every change, as lines: only those near the viewport are
 * coloured and drawn, so a file of fifty thousand lines types as fast as one
 * of fifty.
 */
@Service()
export class UiCodeEditorService {
  private readonly text = signal<readonly string[]>(['']);
  private readonly highlighter = signal(new UiSyntaxHighlighter('plain'));
  private language: UiSyntaxLanguage = 'plain';

  /** Bumped whenever a line's colour may have changed, for `visible` to recompute. */
  private readonly revision = signal(0);

  readonly scrollTop = signal(0);
  readonly viewportHeight = signal(0);
  readonly caret = signal<UiCodePosition>({ line: 1, column: 1 });

  readonly lineCount = computed(() => this.text().length);

  /** What one press of `Tab` inserts: a tab where the file indents with tabs, else its spaces (two by default). */
  readonly indentUnit = computed(() => indentOf(this.text()));

  /** The lines to draw: those in view and a margin around them. */
  readonly visible = computed(() => {
    this.revision();
    const lines = this.text();
    const highlighter = this.highlighter();
    const range = visibleRange({
      total: lines.length,
      lineHeight: UI_CODE_LINE_HEIGHT,
      perLine: 1,
      scrollTop: this.scrollTop(),
      viewportHeight: this.viewportHeight(),
      leading: UI_CODE_PADDING_TOP,
    });
    const rows: UiCodeLine[] = [];
    for (let index = range.start; index < range.end; index++) {
      rows.push({ index, tokens: highlighter.tokens(lines, index) });
    }
    return { start: range.start, rows };
  });

  setLanguage(language: UiSyntaxLanguage): void {
    if (language !== this.language) {
      this.language = language;
      this.highlighter.set(new UiSyntaxHighlighter(language));
    }
  }

  /** The text, as it now is; the colour of everything from the first line that changed is worked out again. */
  setText(value: string): void {
    const before = this.text();
    const lines = value.split('\n');
    let first = 0;
    const shorter = Math.min(before.length, lines.length);
    while (first < shorter && before[first] === lines[first]) {
      first++;
    }
    if (first === lines.length && first === before.length) {
      return;
    }
    this.highlighter().invalidate(first);
    this.text.set(lines);
    this.revision.update((value) => value + 1);
  }

  /** The caret at `offset` of `value`. */
  moveCaret(value: string, offset: number): void {
    let line = 1;
    let start = 0;
    for (let at = value.indexOf('\n'); at !== -1 && at < offset; at = value.indexOf('\n', at + 1)) {
      line++;
      start = at + 1;
    }
    const caret = this.caret();
    if (caret.line !== line || caret.column !== offset - start + 1) {
      this.caret.set({ line, column: offset - start + 1 });
    }
  }
}

/** The indentation the text uses: a tab, or the fewest spaces any line is indented by. */
function indentOf(lines: readonly string[]): string {
  let fewest = Number.POSITIVE_INFINITY;
  const sample = Math.min(lines.length, 2000);
  for (let index = 0; index < sample; index++) {
    const line = lines[index] as string;
    if (line.startsWith('\t')) {
      return '\t';
    }
    const spaces = line.length - line.trimStart().length;
    if (spaces > 1 && spaces < fewest && line.trim() !== '') {
      fewest = spaces;
    }
  }
  return ' '.repeat(Number.isFinite(fewest) ? Math.min(fewest, 8) : 2);
}
