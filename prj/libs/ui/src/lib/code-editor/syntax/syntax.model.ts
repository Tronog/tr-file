/**
 * Syntax highlighting (PRD 005, §4): the languages the editor colours, and
 * what a tokenizer hands back.
 *
 * A tokenizer works a line at a time, carrying a *state* from the end of one
 * line to the start of the next — inside a fenced block, a string, a heredoc.
 * The state is a string, so a cache of them is cheap and comparing two is
 * `===`; `''` is the state a file starts in.
 */

/** A language the editor colours; `plain` colours nothing. */
export type UiSyntaxLanguage = 'plain' | 'markdown' | 'bash' | 'json';

/** What a piece of a line is, as far as colour goes; each is a `--vsc-syntax-*` token. */
export type UiSyntaxKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'literal'
  | 'property'
  | 'variable'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'heading'
  | 'strong'
  | 'emphasis'
  | 'link'
  | 'code'
  | 'quote'
  | 'meta'
  | 'invalid';

/** A run of a line's text, and what it is — `null` for plain text. */
export interface UiSyntaxToken {
  readonly text: string;
  readonly kind: UiSyntaxKind | null;
}

/** One line, tokenized: its runs, and the state the next line starts in. */
export interface UiTokenizedLine {
  readonly tokens: readonly UiSyntaxToken[];
  readonly end: string;
}

/** Tokenizes one line (no `\n`) that starts in `state`. */
export type UiLineTokenizer = (line: string, state: string) => UiTokenizedLine;

/**
 * Collects a line's runs, joining neighbours of the same kind so a line is as
 * few elements as it can be.
 */
export class UiTokenWriter {
  private readonly runs: UiSyntaxToken[] = [];

  push(text: string, kind: UiSyntaxKind | null): void {
    if (text === '') {
      return;
    }
    const last = this.runs.at(-1);
    if (last !== undefined && last.kind === kind) {
      this.runs[this.runs.length - 1] = { text: last.text + text, kind };
      return;
    }
    this.runs.push({ text, kind });
  }

  done(end: string): UiTokenizedLine {
    return { tokens: this.runs, end };
  }
}
