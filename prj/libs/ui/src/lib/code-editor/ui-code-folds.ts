import type { UiSyntaxLanguage } from './syntax/syntax.model';

/**
 * A block of the text that folds (tr-prd PRD 005, §1.2): the line it starts
 * on, which stays in view, and the last of the lines under it that folding
 * hides — `start + 1 … end`, 0-based. A closing bracket, a fence or the next
 * heading is left in view, as VS Code leaves it.
 */
export interface UiCodeFold {
  readonly start: number;
  readonly end: number;
}

/** How many columns a tab takes when indentation is measured. */
const TAB_COLUMNS = 4;

/** A fenced block's opening (or closing) fence. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** An ATX heading, and its level. */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/;

/**
 * Every block of `lines` that folds, as `start → end`.
 *
 * Markdown folds by its headings — a section runs to the next heading of the
 * same level or a higher one — and by its fenced blocks. Everything else folds
 * by indentation, as VS Code does where it knows no better: a line folds the
 * lines after it that are indented further, so JSON's `{ … }`, a bash
 * function's or `if`'s body fold, the closing line staying in view. Blank
 * lines at a block's end are not part of it.
 */
export function foldRanges(lines: readonly string[], language: UiSyntaxLanguage): ReadonlyMap<number, number> {
  const ranges = new Map<number, number>();
  if (language === 'markdown') {
    markdownRanges(lines, ranges);
  } else {
    indentRanges(lines, ranges);
  }
  return ranges;
}

function indentRanges(lines: readonly string[], ranges: Map<number, number>): void {
  const open: { readonly line: number; readonly indent: number }[] = [];
  let last = -1;
  for (let index = 0; index <= lines.length; index++) {
    const indent = index === lines.length ? -1 : indentOf(lines[index] as string);
    if (indent === null) {
      continue;
    }
    while (open.length > 0 && (open.at(-1) as { indent: number }).indent >= indent) {
      const block = open.pop() as { line: number };
      if (last > block.line) {
        ranges.set(block.line, last);
      }
    }
    if (index < lines.length) {
      open.push({ line: index, indent });
      last = index;
    }
  }
}

function markdownRanges(lines: readonly string[], ranges: Map<number, number>): void {
  const sections: { readonly line: number; readonly level: number }[] = [];
  let last = -1;
  const close = (level: number): void => {
    while (sections.length > 0 && (sections.at(-1) as { level: number }).level >= level) {
      const section = sections.pop() as { line: number };
      if (last > section.line) {
        ranges.set(section.line, last);
      }
    }
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    const fence = FENCE.exec(line);
    if (fence) {
      // A fence closes on a line of the same character, at least as long, and nothing else.
      const mark = fence[1] as string;
      const closing = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}[ \\t]*$`);
      let end = index + 1;
      while (end < lines.length && !closing.test(lines[end] as string)) {
        end++;
      }
      // Unclosed, it runs to the end of the text.
      const body = end < lines.length ? end - 1 : lastFilled(lines, lines.length - 1);
      if (body > index) {
        ranges.set(index, body);
      }
      last = end < lines.length ? end : Math.max(last, body);
      index = end;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close((heading[1] as string).length);
      sections.push({ line: index, level: (heading[1] as string).length });
    }
    if (line.trim() !== '') {
      last = index;
    }
  }
  close(0);
}

/** The last line at or before `line` that is not blank. */
function lastFilled(lines: readonly string[], line: number): number {
  while (line >= 0 && (lines[line] as string).trim() === '') {
    line--;
  }
  return line;
}

/** A line's indentation in columns; `null` when the line is blank. */
function indentOf(line: string): number | null {
  let columns = 0;
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (char === ' ') {
      columns++;
    } else if (char === '\t') {
      columns += TAB_COLUMNS - (columns % TAB_COLUMNS);
    } else {
      return columns;
    }
  }
  return null;
}
