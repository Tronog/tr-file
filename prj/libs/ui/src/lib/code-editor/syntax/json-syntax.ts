import { UiTokenWriter, type UiTokenizedLine } from './syntax.model';

/** A number as JSON writes one. */
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /(?:true|false|null)\b/y;
const WORD = /[^\s{}[\],:"/]+/y;

/** Inside a `/* … *\/` comment, which JSON with comments (`tsconfig.json`) allows. */
const IN_COMMENT = 'c';

/**
 * JSON — and JSON with comments (PRD 005, §4): a key (a string a `:` follows)
 * is a property, the rest strings, numbers and `true` / `false` / `null`;
 * anything else is marked invalid. The only state is a block comment.
 */
export function tokenizeJson(line: string, state: string): UiTokenizedLine {
  const out = new UiTokenWriter();
  let at = 0;
  if (state === IN_COMMENT) {
    const close = line.indexOf('*/');
    if (close === -1) {
      out.push(line, 'comment');
      return out.done(IN_COMMENT);
    }
    out.push(line.slice(0, close + 2), 'comment');
    at = close + 2;
  }
  while (at < line.length) {
    const char = line[at] as string;
    if (char === ' ' || char === '\t') {
      const from = at;
      while (line[at] === ' ' || line[at] === '\t') {
        at++;
      }
      out.push(line.slice(from, at), null);
    } else if (line.startsWith('//', at)) {
      out.push(line.slice(at), 'comment');
      at = line.length;
    } else if (line.startsWith('/*', at)) {
      const close = line.indexOf('*/', at + 2);
      if (close === -1) {
        out.push(line.slice(at), 'comment');
        return out.done(IN_COMMENT);
      }
      out.push(line.slice(at, close + 2), 'comment');
      at = close + 2;
    } else if (char === '"') {
      const end = stringEnd(line, at);
      let next = end;
      while (line[next] === ' ' || line[next] === '\t') {
        next++;
      }
      out.push(line.slice(at, end), line[next] === ':' ? 'property' : 'string');
      at = end;
    } else if ('{}[],:'.includes(char)) {
      out.push(char, 'punctuation');
      at++;
    } else {
      const matched = sticky(NUMBER, line, at) ?? sticky(LITERAL, line, at);
      if (matched !== null) {
        out.push(matched, /\d/.test(matched) ? 'number' : 'literal');
        at += matched.length;
      } else {
        const word = sticky(WORD, line, at) ?? char;
        out.push(word, 'invalid');
        at += word.length;
      }
    }
  }
  return out.done('');
}

/** Where the string opening at `from` ends — past its closing quote, or the end of the line. */
function stringEnd(line: string, from: number): number {
  for (let at = from + 1; at < line.length; at++) {
    if (line[at] === '\\') {
      at++;
    } else if (line[at] === '"') {
      return at + 1;
    }
  }
  return line.length;
}

/** What `pattern` matches exactly at `at`, or `null`. */
export function sticky(pattern: RegExp, line: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(line)?.[0] ?? null;
}
