import { tokenizeBash } from './bash-syntax';
import { tokenizeJson } from './json-syntax';
import { createMarkdownTokenizer } from './markdown-syntax';
import type { UiLineTokenizer, UiSyntaxLanguage, UiSyntaxToken } from './syntax.model';

/** Past this, the rest of a line is not coloured — a minified file is one line of megabytes. */
const MAX_COLOURED = 10_000;

const plain: UiLineTokenizer = (line, state) => ({ tokens: line === '' ? [] : [{ text: line, kind: null }], end: state });

/** The tokenizer of a language, or of a fenced block's info string (`sh`, `jsonc` …). */
export function tokenizerFor(language: string): UiLineTokenizer | null {
  switch (language) {
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
    case 'console':
      return tokenizeBash;
    case 'json':
    case 'jsonc':
    case 'json5':
      return tokenizeJson;
    case 'markdown':
    case 'md':
      return markdown;
    default:
      return null;
  }
}

const markdown = createMarkdownTokenizer((language) => (language === 'markdown' || language === 'md' ? null : tokenizerFor(language)));

/**
 * Colours the lines of one text (PRD 005, §4), as many as are asked for.
 *
 * Keeps the state each line starts in, as far as anything has been asked
 * for — so drawing the lines on screen tokenizes those and, the first time,
 * the ones above them; never the rest of the file. An edit forgets the states
 * from the first line it changed (`invalidate`).
 */
export class UiSyntaxHighlighter {
  /** `starts[i]` is the state line `i` starts in; known for every `i` below its length. */
  private readonly starts: string[] = [''];
  private readonly tokenize: UiLineTokenizer;

  constructor(language: UiSyntaxLanguage) {
    this.tokenize = language === 'plain' ? plain : (tokenizerFor(language) ?? plain);
  }

  /** Line `line` and those after it changed: their states are worked out again when asked for. */
  invalidate(line: number): void {
    this.starts.length = Math.max(1, Math.min(this.starts.length, line + 1));
  }

  /** The runs of line `index` of `lines`. */
  tokens(lines: readonly string[], index: number): readonly UiSyntaxToken[] {
    for (let at = this.starts.length - 1; at < index; at++) {
      this.starts.push(this.run(lines[at] ?? '', this.starts[at] as string).end);
    }
    return this.run(lines[index] ?? '', this.starts[index] ?? '').tokens;
  }

  private run(line: string, state: string): { readonly tokens: readonly UiSyntaxToken[]; readonly end: string } {
    if (line.length <= MAX_COLOURED) {
      return this.tokenize(line, state);
    }
    const head = this.tokenize(line.slice(0, MAX_COLOURED), state);
    return { tokens: [...head.tokens, { text: line.slice(MAX_COLOURED), kind: null }], end: head.end };
  }
}
