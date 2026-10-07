import { sticky } from './json-syntax';
import { UiTokenWriter, type UiTokenizedLine } from './syntax.model';

const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'while', 'until', 'do', 'done', 'case', 'esac',
  'function', 'select', 'time', 'return', 'exit', 'break', 'continue', 'local', 'export', 'readonly',
  'declare', 'typeset', 'unset', 'shift', 'trap', 'eval', 'exec', 'source',
]);

const BUILTINS = new Set([
  'echo', 'printf', 'read', 'cd', 'pwd', 'test', 'set', 'alias', 'unalias', 'type', 'command', 'builtin',
  'let', 'getopts', 'wait', 'kill', 'jobs', 'bg', 'fg', 'pushd', 'popd', 'dirs', 'umask', 'ulimit',
  'mapfile', 'readarray', 'true', 'false', 'hash', 'help', 'history', 'shopt', 'complete',
]);

const WORD = /[^\s'"`$#|&;<>(){}[\]\\]+/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const ASSIGNMENT = /[A-Za-z_][A-Za-z0-9_]*(?=\+?=)/y;
const SPECIAL_PARAMETER = /[0-9@*#?$!-]/y;
const HEREDOC = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/y;
const OPERATOR = /&&|\|\||;;|\[\[|\]\]|[|&;<>(){}[\]=]/y;
const NUMBER = /\d+(?![^\s;|&<>()])/y;

/**
 * States: `''`, inside `'…'` (`'`), inside `"…"` (`"`), or the body of a
 * heredoc — `h` and its delimiter, `H` for `<<-`, whose closing line may be
 * indented with tabs.
 */
const SINGLE = "'";
const DOUBLE = '"';

/**
 * Bash (PRD 005, §4): comments, the two kinds of string — `$` expansions
 * coloured inside the double kind —, `$` variables, heredocs, keywords,
 * builtins, assignments and operators. A string or a heredoc may run over
 * several lines; that is the state carried.
 */
export function tokenizeBash(line: string, state: string): UiTokenizedLine {
  const out = new UiTokenWriter();

  if (state.startsWith('h') || state.startsWith('H')) {
    const delimiter = state.slice(1);
    const closing = state.startsWith('H') ? line.replace(/^\t+/, '') : line;
    if (closing === delimiter) {
      out.push(line, 'meta');
      return out.done('');
    }
    out.push(line, 'string');
    return out.done(state);
  }

  let at = 0;
  let heredoc: string | null = null;
  if (state === SINGLE) {
    at = singleQuoted(line, 0, out);
    if (at === -1) {
      return out.done(SINGLE);
    }
  } else if (state === DOUBLE) {
    at = doubleQuoted(line, 0, out);
    if (at === -1) {
      return out.done(DOUBLE);
    }
  }

  // Where a word starts: a `#` there begins a comment, a name there may be a command.
  let wordStart = true;
  while (at < line.length) {
    const char = line[at] as string;
    if (char === ' ' || char === '\t') {
      out.push(char, null);
      at++;
      wordStart = true;
      continue;
    }
    if (char === '#' && wordStart) {
      out.push(line.slice(at), 'comment');
      break;
    }
    if (char === '\\') {
      out.push(line.slice(at, at + 2), null);
      at += 2;
      wordStart = false;
      continue;
    }
    if (char === SINGLE) {
      at = singleQuoted(line, at + 1, out, true);
      if (at === -1) {
        return out.done(SINGLE);
      }
      wordStart = false;
      continue;
    }
    if (char === DOUBLE) {
      at = doubleQuoted(line, at + 1, out, true);
      if (at === -1) {
        return out.done(DOUBLE);
      }
      wordStart = false;
      continue;
    }
    if (char === '$') {
      at = expansion(line, at, out);
      wordStart = false;
      continue;
    }
    if (char === '`') {
      out.push(char, 'operator');
      at++;
      wordStart = true;
      continue;
    }
    HEREDOC.lastIndex = at;
    const here = HEREDOC.exec(line);
    if (here !== null) {
      const [whole, dash, , delimiter] = here;
      const marker = dash === '-' ? 3 : 2;
      out.push(whole.slice(0, marker), 'operator');
      out.push(whole.slice(marker), 'meta');
      heredoc = `${dash === '-' ? 'H' : 'h'}${delimiter ?? ''}`;
      at += whole.length;
      wordStart = false;
      continue;
    }
    const operator = sticky(OPERATOR, line, at);
    if (operator !== null) {
      out.push(operator, 'operator');
      at += operator.length;
      wordStart = true;
      continue;
    }
    const assignment = wordStart ? sticky(ASSIGNMENT, line, at) : null;
    if (assignment !== null) {
      out.push(assignment, 'variable');
      at += assignment.length;
      wordStart = false;
      continue;
    }
    const number = wordStart ? sticky(NUMBER, line, at) : null;
    if (number !== null) {
      out.push(number, 'number');
      at += number.length;
      wordStart = false;
      continue;
    }
    const word = sticky(WORD, line, at) ?? char;
    out.push(word, wordStart && KEYWORDS.has(word) ? 'keyword' : wordStart && BUILTINS.has(word) ? 'function' : null);
    at += word.length;
    wordStart = false;
  }
  return out.done(heredoc ?? '');
}

/** A `'…'` string from `from` (just past its quote); where it ends, or `-1` when it runs on. */
function singleQuoted(line: string, from: number, out: UiTokenWriter, opened = false): number {
  const close = line.indexOf(SINGLE, from);
  const start = opened ? from - 1 : from;
  if (close === -1) {
    out.push(line.slice(start), 'string');
    return -1;
  }
  out.push(line.slice(start, close + 1), 'string');
  return close + 1;
}

/** A `"…"` string from `from` (just past its quote), its expansions coloured; where it ends, or `-1`. */
function doubleQuoted(line: string, from: number, out: UiTokenWriter, opened = false): number {
  if (opened) {
    out.push(DOUBLE, 'string');
  }
  let run = from;
  let at = from;
  while (at < line.length) {
    const char = line[at];
    if (char === '\\') {
      at += 2;
    } else if (char === DOUBLE) {
      out.push(line.slice(run, at + 1), 'string');
      return at + 1;
    } else if (char === '$' && /[A-Za-z_{(0-9@*#?$!-]/.test(line[at + 1] ?? '')) {
      out.push(line.slice(run, at), 'string');
      at = expansion(line, at, out);
      run = at;
    } else {
      at++;
    }
  }
  out.push(line.slice(run), 'string');
  return -1;
}

/** `$name`, `${…}`, `$(` / `$((`, `$1`, `$@` … at `at`; where it ends. */
function expansion(line: string, at: number, out: UiTokenWriter): number {
  const next = line[at + 1];
  if (next === '{') {
    const close = line.indexOf('}', at + 2);
    const end = close === -1 ? line.length : close + 1;
    out.push(line.slice(at, end), 'variable');
    return end;
  }
  if (next === '(') {
    const length = line[at + 2] === '(' ? 3 : 2;
    out.push(line.slice(at, at + length), 'operator');
    return at + length;
  }
  const name = sticky(NAME, line, at + 1) ?? sticky(SPECIAL_PARAMETER, line, at + 1);
  if (name !== null) {
    out.push(line.slice(at, at + 1 + name.length), 'variable');
    return at + 1 + name.length;
  }
  out.push('$', null);
  return at + 1;
}
