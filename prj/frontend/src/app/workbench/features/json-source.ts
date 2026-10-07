import type { UiJsonEdit } from '@tr-file/ui';

/** Where a value is in the text, and — in an object — its key: `[start, end)` offsets. */
interface JsonSpan {
  readonly key?: readonly [number, number];
  readonly value: readonly [number, number];
}

/** A JSON text read with where each of its values is, by JSON pointer. */
export interface JsonSource {
  readonly value: unknown;
  readonly spans: ReadonlyMap<string, JsonSpan>;
}

/**
 * Reads a JSON text noting where every value — and every key — is
 * (PRD 005, §5.2), so an edit in the tree changes those characters and
 * nothing else: the file keeps its own layout, its key order, its numbers as
 * they were written. Strict JSON, as `JSON.parse` takes it; `null` for
 * anything else.
 */
export function readJsonSource(text: string): JsonSource | null {
  const spans = new Map<string, JsonSpan>();
  let at = 0;

  const space = (): void => {
    while (at < text.length && (text[at] === ' ' || text[at] === '\t' || text[at] === '\n' || text[at] === '\r')) {
      at++;
    }
  };
  const fail = (): never => {
    throw new SyntaxError(`Unexpected input at ${at}`);
  };
  const string = (): string => {
    const start = at;
    at++;
    while (at < text.length && text[at] !== '"') {
      at += text[at] === '\\' ? 2 : 1;
    }
    if (at >= text.length) {
      fail();
    }
    at++;
    return JSON.parse(text.slice(start, at)) as string;
  };
  const value = (pointer: string, key?: readonly [number, number]): unknown => {
    space();
    const start = at;
    let result: unknown;
    const char = text[at];
    if (char === '{') {
      at++;
      const object: Record<string, unknown> = {};
      space();
      if (text[at] === '}') {
        at++;
      } else {
        for (;;) {
          space();
          if (text[at] !== '"') {
            fail();
          }
          const keyStart = at;
          const name = string();
          const keySpan = [keyStart, at] as const;
          space();
          if (text[at] !== ':') {
            fail();
          }
          at++;
          object[name] = value(`${pointer}/${escapePointer(name)}`, keySpan);
          space();
          if (text[at] === ',') {
            at++;
          } else if (text[at] === '}') {
            at++;
            break;
          } else {
            fail();
          }
        }
      }
      result = object;
    } else if (char === '[') {
      at++;
      const array: unknown[] = [];
      space();
      if (text[at] === ']') {
        at++;
      } else {
        for (;;) {
          array.push(value(`${pointer}/${array.length}`));
          space();
          if (text[at] === ',') {
            at++;
          } else if (text[at] === ']') {
            at++;
            break;
          } else {
            fail();
          }
        }
      }
      result = array;
    } else if (char === '"') {
      result = string();
    } else {
      const literal = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at, at + 400));
      if (literal === null) {
        fail();
      }
      at += (literal as RegExpExecArray)[0].length;
      result = JSON.parse((literal as RegExpExecArray)[0]);
    }
    spans.set(pointer, { ...(key === undefined ? {} : { key }), value: [start, at] });
    return result;
  };

  try {
    const result = value('');
    space();
    return at === text.length ? { value: result, spans } : null;
  } catch {
    return null;
  }
}

/**
 * The text with one edit of the tree in it (PRD 005, §5.2): a value written
 * over the old one, or a key renamed where it stands — or why it cannot be.
 */
export function applyJsonEdit(text: string, edit: UiJsonEdit): { readonly text: string } | { readonly problem: string } {
  const source = readJsonSource(text);
  if (source === null) {
    return { problem: 'The file is no longer valid JSON.' };
  }
  const span = source.spans.get(edit.pointer);
  if (span === undefined) {
    return { problem: 'That value is no longer in the file.' };
  }
  if (edit.key !== undefined) {
    if (span.key === undefined) {
      return { problem: 'Only a key of an object can be renamed.' };
    }
    const parentPointer = edit.pointer.slice(0, edit.pointer.lastIndexOf('/'));
    const parent = source.spans.get(parentPointer) === undefined ? undefined : valueAt(source.value, parentPointer);
    if (parent !== undefined && Object.hasOwn(parent as object, edit.key)) {
      return { problem: `There is a key "${edit.key}" already.` };
    }
    return { text: splice(text, span.key, JSON.stringify(edit.key)) };
  }
  return { text: splice(text, span.value, JSON.stringify(edit.value)) };
}

function splice(text: string, [start, end]: readonly [number, number], replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

function valueAt(value: unknown, pointer: string): unknown {
  let current = value;
  for (const raw of pointer === '' ? [] : pointer.slice(1).split('/')) {
    current = (current as Record<string, unknown>)[raw.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return current;
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
