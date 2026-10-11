import { Service, computed, signal } from '@angular/core';
import { visibleRange } from '../virtual/ui-virtual-viewport';
import { UiSyntaxHighlighter } from './syntax/syntax-highlighter';
import type { UiSyntaxLanguage, UiSyntaxToken } from './syntax/syntax.model';
import { foldRanges, type UiCodeFold } from './ui-code-folds';

/** Height of one line, in CSS pixels — fixed, so where a line is needs no measuring. */
export const UI_CODE_LINE_HEIGHT = 19;

/** Space above the first line, as the textarea pads it. */
export const UI_CODE_PADDING_TOP = 4;

/** A coloured run of a line on screen — marked where it is a match of the find bar's query. */
export interface UiCodeRun extends UiSyntaxToken {
  readonly mark?: 'match' | 'current';
}

/** One line on screen: its index, its coloured runs, and whether a block folds from it — open, or folded. */
export interface UiCodeLine {
  readonly index: number;
  readonly tokens: readonly UiCodeRun[];
  readonly fold?: 'open' | 'folded';
}

/**
 * A fold in effect, in the text's offsets: the hidden lines are `[at, at +
 * length)` of the text — the break ending the fold's first line and the lines
 * after it — and sit at `view` in the text the textarea holds.
 */
interface UiCodeSpan {
  readonly start: number;
  readonly at: number;
  readonly length: number;
  readonly view: number;
}

/** A match of the find bar's query: its line (0-based) and columns `[start, end)`. */
export interface UiCodeMatch {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

/** Find stops counting here. */
const MAX_MATCHES = 10_000;

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
  private readonly language = signal<UiSyntaxLanguage>('plain');

  /** The whole text, folded lines and all — what the editor reports. */
  private value = '';

  /** The folded blocks (tr-prd PRD 005, §1.2), by `start`; those inside another folded one too. */
  private readonly folds = signal<readonly UiCodeFold[]>([]);

  /** Bumped whenever a line's colour may have changed, for `visible` to recompute. */
  private readonly revision = signal(0);

  readonly scrollTop = signal(0);
  readonly viewportHeight = signal(0);
  readonly caret = signal<UiCodePosition>({ line: 1, column: 1 });

  readonly lineCount = computed(() => this.text().length);

  /* -- folds (tr-prd PRD 005, §1.2) ---------------------------------------- */

  /** Every block that folds, as `start → end`. */
  readonly foldable = computed(() => foldRanges(this.text(), this.language()));

  /** The folds that hide lines: the outermost — one inside a folded block is hidden with it, and kept for when it opens. */
  readonly hidden = computed<readonly UiCodeFold[]>(() => {
    const hidden: UiCodeFold[] = [];
    let last = -1;
    for (const fold of this.folds()) {
      if (fold.start > last) {
        hidden.push(fold);
        last = fold.end;
      }
    }
    return hidden;
  });

  /** How many lines are on screen, the folded ones not counted. */
  readonly rowCount = computed(() => this.hidden().reduce((count, fold) => count - (fold.end - fold.start), this.text().length));

  /** Where the hidden lines are, in the text and in the textarea's. */
  private readonly spans = computed<readonly UiCodeSpan[]>(() => {
    const lines = this.text();
    const spans: UiCodeSpan[] = [];
    let offset = 0;
    let line = 0;
    let shift = 0;
    for (const fold of this.hidden()) {
      for (; line < fold.start; line++) {
        offset += (lines[line] as string).length + 1;
      }
      const at = offset + (lines[fold.start] as string).length;
      let length = 0;
      for (let index = fold.start + 1; index <= fold.end; index++) {
        length += (lines[index] as string).length + 1;
      }
      spans.push({ start: fold.start, at, length, view: at - shift });
      shift += length;
      offset = at + length + 1;
      line = fold.end + 1;
    }
    return spans;
  });

  /** The text the textarea holds: the whole of it, but the folded lines. */
  readonly shown = computed(() => {
    const lines = this.text();
    const hidden = this.hidden();
    if (hidden.length === 0) {
      return this.value;
    }
    const shown: string[] = [];
    let line = 0;
    for (const fold of hidden) {
      for (; line <= fold.start; line++) {
        shown.push(lines[line] as string);
      }
      line = fold.end + 1;
    }
    for (; line < lines.length; line++) {
      shown.push(lines[line] as string);
    }
    return shown.join('\n');
  });

  /** The whole text. */
  content(): string {
    return this.value;
  }

  /** The row on screen of line `line` — of the line its block folds under, when it is hidden. */
  rowOf(line: number): number {
    let row = line;
    for (const fold of this.hidden()) {
      if (line <= fold.start) {
        break;
      }
      if (line <= fold.end) {
        return row - (line - fold.start);
      }
      row -= fold.end - fold.start;
    }
    return row;
  }

  /** The line on row `row` of the screen. */
  lineAt(row: number): number {
    let line = row;
    for (const fold of this.hidden()) {
      if (fold.start >= line) {
        break;
      }
      line += fold.end - fold.start;
    }
    return line;
  }

  /** Whether line `line` is folded away. */
  isHidden(line: number): boolean {
    return this.hidden().some((fold) => fold.start < line && line <= fold.end);
  }

  /**
   * The offset in the text of offset `offset` of the textarea's. Where lines
   * are folded away, it is the end of the line they fold under — or, `after`,
   * the end of the last of them.
   */
  toFull(offset: number, after = false): number {
    let shift = 0;
    for (const span of this.spans()) {
      if (span.view > offset || (span.view === offset && !after)) {
        break;
      }
      shift += span.length;
    }
    return offset + shift;
  }

  /** The offset in the textarea's text of offset `offset` of the text; one in folded lines, the end of the line they fold under. */
  toView(offset: number): number {
    let shift = 0;
    for (const span of this.spans()) {
      if (offset <= span.at) {
        break;
      }
      if (offset < span.at + span.length) {
        return span.at - shift;
      }
      shift += span.length;
    }
    return offset - shift;
  }

  /** Whether replacing `[from, to)` of the textarea's text would take folded lines with it. */
  crosses(from: number, to: number): boolean {
    return this.spans().some((span) => from <= span.view && span.view < to);
  }

  /** Folds the block that starts on line `line`, or opens it when it is folded. */
  toggleFold(line: number): boolean {
    return this.folds().some((fold) => fold.start === line) ? this.unfold((fold) => fold.start === line) : this.fold(line);
  }

  /** Folds the innermost block around line `line` that is not folded yet. */
  foldAt(line: number): boolean {
    let start = -1;
    for (const [from, end] of this.foldable()) {
      if (from <= line && line <= end && from > start && !this.folds().some((fold) => fold.start === from)) {
        start = from;
      }
    }
    return start !== -1 && this.fold(start);
  }

  /** Opens the folded blocks line `line` is in, or starts. */
  unfoldAt(line: number): boolean {
    return this.unfold((fold) => fold.start <= line && line <= fold.end);
  }

  /** Opens every folded block that hides line `line`. */
  reveal(line: number): boolean {
    return this.unfold((fold) => fold.start < line && line <= fold.end);
  }

  /** Folds every block that folds. */
  foldAll(): boolean {
    const folds = [...this.foldable()].map(([start, end]) => ({ start, end })).sort((a, b) => a.start - b.start);
    if (folds.length === 0) {
      return false;
    }
    this.folds.set(folds);
    return true;
  }

  unfoldAll(): boolean {
    return this.unfold(() => true);
  }

  /** Opens the folded blocks whose hidden lines start in `[from, to)` of the text. */
  unfoldBetween(from: number, to: number): boolean {
    const starts = lineStarts(this.text());
    const lines = this.text();
    return this.unfold((fold) => {
      const at = (starts[fold.start] as number) + (lines[fold.start] as string).length;
      return from <= at && at < to;
    });
  }

  private fold(start: number): boolean {
    const end = this.foldable().get(start);
    if (end === undefined) {
      return false;
    }
    this.folds.update((folds) => [...folds.filter((fold) => fold.start !== start), { start, end }].sort((a, b) => a.start - b.start));
    return true;
  }

  private unfold(which: (fold: UiCodeFold) => boolean): boolean {
    const folds = this.folds();
    const kept = folds.filter((fold) => !which(fold));
    if (kept.length === folds.length) {
      return false;
    }
    this.folds.set(kept);
    return true;
  }

  /**
   * The textarea's text, as an edit left it, worked into the whole text; the
   * offset in the whole text where the caret — `caret` of the textarea's — is.
   *
   * The edit is found by comparing the textarea's text before and after it,
   * from the end — no nearer than the caret — then from the start. Text put
   * where folded lines are — at the end of the line they fold under — goes
   * before them, unless it starts a new line (`Enter` there, or what undoing
   * it takes away), which goes after them. A fold whose hidden lines the edit
   * reaches into is dropped with them; the editor opens one before letting
   * an edit do that (`crosses`).
   */
  input(value: string, caret: number): number {
    if (this.spans().length === 0) {
      this.setText(value);
      return caret;
    }
    const before = this.shown();
    const most = Math.min(before.length, value.length);
    let suffix = 0;
    for (const limit = Math.min(most, value.length - caret); suffix < limit && before.charCodeAt(before.length - 1 - suffix) === value.charCodeAt(value.length - 1 - suffix); ) {
      suffix++;
    }
    let prefix = 0;
    while (prefix < most - suffix && before.charCodeAt(prefix) === value.charCodeAt(prefix)) {
      prefix++;
    }
    const to = before.length - suffix;
    const inserted = value.slice(prefix, value.length - suffix);
    const from = this.toFull(prefix, to > prefix || inserted.startsWith('\n'));
    this.replace(from, to === prefix ? from : this.toFull(to), inserted);
    return from + inserted.length;
  }

  /** `[from, to)` of the whole text replaced with `text`, the folds after it moved with their lines. */
  private replace(from: number, to: number, text: string): void {
    const lines = this.text();
    const starts = lineStarts(lines);
    const delta = breaks(text) - breaks(this.value.slice(from, to));
    const folds = this.folds().flatMap((fold) => {
      const at = (starts[fold.start] as number) + (lines[fold.start] as string).length;
      const end = (starts[fold.end] as number) + (lines[fold.end] as string).length;
      if (from < end && to > at) {
        return [];
      }
      return to <= at ? [{ start: fold.start + delta, end: fold.end + delta }] : [fold];
    });
    this.setText(this.value.slice(0, from) + text + this.value.slice(to));
    const count = this.text().length;
    this.folds.set(folds.filter((fold) => fold.start >= 0 && fold.start < fold.end && fold.end < count));
  }

  /** A new text in place of the old — another file's, or the same one reformatted: nothing is folded. */
  load(value: string): void {
    this.folds.set([]);
    this.setText(value);
  }

  /** The find bar's query (PRD 005, §5.1); `''` while it is closed. */
  readonly findQuery = signal('');
  /** Which match the editor went to; `-1` before any. */
  readonly findIndex = signal(-1);

  /** Every match of the query, line by line, case ignored. */
  readonly matches = computed<readonly UiCodeMatch[]>(() => {
    const query = this.findQuery().toLowerCase();
    if (query === '') {
      return [];
    }
    const found: UiCodeMatch[] = [];
    const lines = this.text();
    for (let line = 0; line < lines.length && found.length < MAX_MATCHES; line++) {
      const text = (lines[line] as string).toLowerCase();
      for (let at = text.indexOf(query); at !== -1 && found.length < MAX_MATCHES; at = text.indexOf(query, at + query.length)) {
        found.push({ line, start: at, end: at + query.length });
      }
    }
    return found;
  });

  /** The offset in the text where line `line` starts. */
  offsetOf(line: number, column: number): number {
    const lines = this.text();
    let offset = 0;
    for (let index = 0; index < line; index++) {
      offset += (lines[index] as string).length + 1;
    }
    return offset + column;
  }

  /** The text of line `line`. */
  lineText(line: number): string {
    return this.text()[line] ?? '';
  }

  /** What one press of `Tab` inserts: a tab where the file indents with tabs, else its spaces (two by default). */
  readonly indentUnit = computed(() => indentOf(this.text()));

  /** The lines to draw: those in view and a margin around them. */
  readonly visible = computed(() => {
    this.revision();
    const lines = this.text();
    const highlighter = this.highlighter();
    const hidden = this.hidden();
    const foldable = this.foldable();
    const range = visibleRange({
      total: this.rowCount(),
      lineHeight: UI_CODE_LINE_HEIGHT,
      perLine: 1,
      scrollTop: this.scrollTop(),
      viewportHeight: this.viewportHeight(),
      leading: UI_CODE_PADDING_TOP,
    });
    const matches = this.matches();
    const current = matches[this.findIndex()];
    // The matches in view, by line: the first one at or after the first line drawn, found by halving.
    const top = this.lineAt(range.start);
    let first = 0;
    for (let high = matches.length; first < high; ) {
      const middle = (first + high) >> 1;
      if ((matches[middle] as UiCodeMatch).line < top) {
        first = middle + 1;
      } else {
        high = middle;
      }
    }
    const rows: UiCodeLine[] = [];
    for (let row = range.start; row < range.end; row++) {
      const index = this.lineAt(row);
      const tokens = highlighter.tokens(lines, index);
      const inLine: UiCodeMatch[] = [];
      // Those in folded lines are passed over.
      while (first < matches.length && (matches[first] as UiCodeMatch).line < index) {
        first++;
      }
      while (first < matches.length && (matches[first] as UiCodeMatch).line === index) {
        inLine.push(matches[first] as UiCodeMatch);
        first++;
      }
      const fold = hidden.some((block) => block.start === index) ? 'folded' : foldable.has(index) ? 'open' : undefined;
      rows.push({ index, tokens: inLine.length === 0 ? tokens : marked(tokens, inLine, current), ...(fold ? { fold } : {}) });
    }
    return { start: range.start, rows };
  });

  setLanguage(language: UiSyntaxLanguage): void {
    if (language !== this.language()) {
      this.language.set(language);
      this.highlighter.set(new UiSyntaxHighlighter(language));
    }
  }

  /** The text, as it now is; the colour of everything from the first line that changed is worked out again. */
  setText(value: string): void {
    this.value = value;
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

/** `tokens` cut at the edges of `matches` (all in one line), the matched runs marked. */
function marked(tokens: readonly UiSyntaxToken[], matches: readonly UiCodeMatch[], current: UiCodeMatch | undefined): UiCodeRun[] {
  const runs: UiCodeRun[] = [];
  let at = 0;
  for (const token of tokens) {
    const end = at + token.text.length;
    let from = at;
    for (const match of matches) {
      if (match.end <= from || match.start >= end) {
        continue;
      }
      if (match.start > from) {
        runs.push({ text: token.text.slice(from - at, match.start - at), kind: token.kind });
      }
      const until = Math.min(end, match.end);
      runs.push({ text: token.text.slice(Math.max(from, match.start) - at, until - at), kind: token.kind, mark: match === current ? 'current' : 'match' });
      from = until;
    }
    if (from < end) {
      runs.push({ text: token.text.slice(from - at), kind: token.kind });
    }
    at = end;
  }
  return runs;
}

/** Where each line starts in the text. */
function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

/** How many line breaks `text` has. */
function breaks(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    count++;
  }
  return count;
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
