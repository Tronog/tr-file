/**
 * Filtering a list by what was typed, the way VS Code's quick input does it
 * (PRD 009, §1): case-insensitive, every word of the query has to match
 * somewhere, and a word matches as a run of characters or, failing that, as
 * characters in order — so `jf` finds "Jump to Folder". Runs beat scattered
 * characters, and matches at the start of a word beat matches inside one.
 */

export interface UiFuzzyMatch {
  /** Higher is better. */
  readonly score: number;
  /** Matched characters of the text, as merged `[start, end)` ranges. */
  readonly ranges: readonly (readonly [number, number])[];
}

const SEPARATORS = new Set([' ', ':', '-', '_', '.', '/', '\\', '…', '(', '[']);

/** How well `text` matches `query`, or `null` when it does not. An empty query matches everything. */
export function fuzzyMatch(query: string, text: string): UiFuzzyMatch | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let score = 0;
  const ranges: [number, number][] = [];

  for (const word of words) {
    const match = matchWord(word, lower, text);
    if (match === null) {
      return null;
    }
    score += match.score;
    ranges.push(...match.ranges);
  }

  return { score, ranges: merge(ranges) };
}

function matchWord(word: string, lower: string, text: string): { score: number; ranges: [number, number][] } | null {
  // A run: the earliest one at a word start, else the earliest anywhere.
  let best = -1;
  for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
    if (isWordStart(text, at)) {
      best = at;
      break;
    }
    if (best === -1) {
      best = at;
    }
  }
  if (best !== -1) {
    return { score: 100 + (isWordStart(text, best) ? 50 : 0) + word.length - best * 0.1, ranges: [[best, best + word.length]] };
  }

  // Characters in order, each at the next word start if there is one ahead.
  const ranges: [number, number][] = [];
  let at = 0;
  let starts = 0;
  for (const char of word) {
    let found = -1;
    for (let index = at; index < lower.length; index += 1) {
      if (lower[index] === char && isWordStart(text, index)) {
        found = index;
        break;
      }
    }
    if (found === -1) {
      found = lower.indexOf(char, at);
    }
    if (found === -1) {
      return null;
    }
    if (isWordStart(text, found)) {
      starts += 1;
    }
    ranges.push([found, found + 1]);
    at = found + 1;
  }
  return { score: 10 + starts * 10 - ranges.length, ranges };
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text[index - 1] as string;
  const current = text[index] as string;
  return SEPARATORS.has(previous) || (previous === previous.toLowerCase() && current !== current.toLowerCase());
}

function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}
