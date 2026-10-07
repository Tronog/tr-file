import { Service, computed, signal } from '@angular/core';

/** What a JSON value is, for colour and for the twisty. */
export type UiJsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/** One row of the tree: a value, under the key or index it has in its parent. */
export interface UiJsonRow {
  /** Its JSON pointer — `''` for the whole document, `/items/0/name` below. */
  readonly id: string;
  readonly depth: number;
  /** Its key in an object, its index in an array; `null` for the whole document. */
  readonly key: string | null;
  readonly inArray: boolean;
  readonly kind: UiJsonKind;
  /** The value as JSON writes it — a container as `{` / `[` open, `{…}` / `[…]` closed. */
  readonly preview: string;
  /** How many keys or items a container holds; `0` for anything else. */
  readonly size: number;
  readonly expanded: boolean;
  /** The value itself, for a string, a number, `true` / `false` / `null`: what editing starts from. */
  readonly scalar?: string | number | boolean | null;
}

/**
 * An edit made in the tree (PRD 005, §5.2): the value at `pointer` given a
 * new `value`, or its key renamed to `key`. The application writes it into the
 * file's text.
 */
export interface UiJsonEdit {
  readonly pointer: string;
  readonly value?: string | number | boolean | null;
  readonly key?: string;
}

/** A key or a value being typed into. */
export interface UiJsonEditing {
  readonly id: string;
  readonly part: 'key' | 'value';
  readonly draft: string;
  /** Why the draft cannot be put in, while it cannot. */
  readonly error?: string;
}

/** A row drawn of a string is cut here; the file has the rest. */
const MAX_PREVIEW = 300;

/** A document of up to this many values opens two levels deep; anything larger, one. */
const SMALL_DOCUMENT = 400;

/** Search stops counting here — enough to step through, never a frozen tab. */
const MAX_MATCHES = 10_000;

/**
 * The JSON viewer's model (PRD 005, §5): the document, which of its objects
 * and arrays are open, and the row the keyboard is on — flattened into the
 * rows on show, walking only into what is open.
 *
 * Search (§5.1) looks through every key and value, open or not; stepping to a
 * match opens what it is in. Editing (§5.2) is a key or a scalar value typed
 * into in place, reported as a `UiJsonEdit`.
 *
 * Provided by `UiJsonTree`, one per tree, like the image viewer's.
 */
@Service()
export class UiJsonTreeService {
  private readonly value = signal<unknown>(null);
  private readonly expanded = signal<ReadonlySet<string>>(new Set(['']));
  private started = false;
  readonly focusedId = signal('');

  readonly query = signal('');
  /** Which match the cursor was taken to; `-1` before any. */
  readonly current = signal(-1);
  readonly editing = signal<UiJsonEditing | null>(null);

  readonly rows = computed<readonly UiJsonRow[]>(() => {
    const expanded = this.expanded();
    const rows: UiJsonRow[] = [];
    const walk = (value: unknown, id: string, key: string | null, inArray: boolean, depth: number): void => {
      const kind = kindOf(value);
      const container = kind === 'object' || kind === 'array';
      const open = container && expanded.has(id);
      const entries = container ? childrenOf(value) : [];
      rows.push({
        id,
        depth,
        key,
        inArray,
        kind,
        preview: previewOf(value, kind, open),
        size: entries.length,
        expanded: open,
        ...(container ? {} : { scalar: value as string | number | boolean | null }),
      });
      if (open) {
        const array = kind === 'array';
        for (const [childKey, child] of entries) {
          walk(child, `${id}/${escapePointer(childKey)}`, childKey, array, depth + 1);
        }
      }
    };
    walk(this.value(), '', null, false, 0);
    return rows;
  });

  readonly focusedIndex = computed(() => Math.max(0, this.rows().findIndex((row) => row.id === this.focusedId())));

  /** Where the focused value is, as a path someone would write: `$.items[0].name`. */
  readonly focusedPath = computed(() => pathOf(this.focusedId(), this.value()));

  /** Every value whose key or text holds the query, in document order (§5.1). */
  readonly matches = computed<readonly string[]>(() => {
    const query = this.query().trim().toLowerCase();
    if (query === '') {
      return [];
    }
    const found: string[] = [];
    const walk = (value: unknown, id: string, key: string | null): void => {
      if (found.length >= MAX_MATCHES) {
        return;
      }
      const container = isContainer(value);
      const keyHit = key !== null && key.toLowerCase().includes(query);
      const valueHit = !container && String(value).toLowerCase().includes(query);
      if (keyHit || valueHit) {
        found.push(id);
      }
      for (const [childKey, child] of childrenOf(value)) {
        walk(child, `${id}/${escapePointer(childKey)}`, Array.isArray(value) ? null : childKey);
      }
    };
    walk(this.value(), '', null);
    return found;
  });

  readonly matchSet = computed(() => new Set(this.matches()));

  /**
   * The document: on the first, opened at the top — two levels deep when
   * small — with the keyboard on its first row. A later one is the same
   * document changed (an edit, a reload): what was open stays open.
   */
  setValue(value: unknown): void {
    this.value.set(value);
    if (this.started) {
      return;
    }
    this.started = true;
    const open = new Set(['']);
    if (countValues(value, SMALL_DOCUMENT) < SMALL_DOCUMENT) {
      for (const [key, child] of childrenOf(value)) {
        if (isContainer(child)) {
          open.add(`/${escapePointer(key)}`);
        }
      }
    }
    this.expanded.set(open);
    this.focusedId.set('');
  }

  focus(id: string): void {
    this.focusedId.set(id);
  }

  toggle(id: string): void {
    this.setOpen(id, !this.expanded().has(id));
  }

  /** Opens every object and array, or closes all but the top. */
  expandAll(): void {
    const open = new Set<string>();
    const walk = (value: unknown, id: string): void => {
      if (!isContainer(value)) {
        return;
      }
      open.add(id);
      for (const [key, child] of childrenOf(value)) {
        walk(child, `${id}/${escapePointer(key)}`);
      }
    };
    walk(this.value(), '');
    this.expanded.set(open);
  }

  collapseAll(): void {
    this.expanded.set(new Set(['']));
    this.focusedId.set('');
  }

  /** A step up or down the rows, by `delta`; clamped at either end. */
  move(delta: number): void {
    const rows = this.rows();
    const next = rows[Math.min(rows.length - 1, Math.max(0, this.focusedIndex() + delta))];
    if (next !== undefined) {
      this.focusedId.set(next.id);
    }
  }

  moveTo(index: number): void {
    const rows = this.rows();
    const row = rows[index < 0 ? rows.length + index : index];
    if (row !== undefined) {
      this.focusedId.set(row.id);
    }
  }

  /** `→`: opens a closed container, steps into an open one. */
  right(): void {
    const row = this.rows()[this.focusedIndex()];
    if (row === undefined || row.size === 0) {
      return;
    }
    if (row.expanded) {
      this.move(1);
    } else {
      this.setOpen(row.id, true);
    }
  }

  /** `←`: closes an open container, else steps out to the one it is in. */
  left(): void {
    const row = this.rows()[this.focusedIndex()];
    if (row === undefined) {
      return;
    }
    if (row.expanded && row.id !== '') {
      this.setOpen(row.id, false);
    } else if (row.id !== '') {
      this.focusedId.set(row.id.slice(0, row.id.lastIndexOf('/')));
    }
  }

  /* -- search (§5.1) ------------------------------------------------------- */

  setQuery(query: string): void {
    this.query.set(query);
    this.current.set(-1);
  }

  /**
   * To the next match after the cursor — or, `-1`, the one before — round
   * at either end; what it is in is opened. `false` when nothing matches.
   */
  step(direction: 1 | -1): boolean {
    const matches = this.matches();
    if (matches.length === 0) {
      return false;
    }
    const current = this.current();
    // The first match — or the last, going back — then on from the one the cursor was taken to.
    const index = current < 0 || current >= matches.length ? (direction === 1 ? 0 : matches.length - 1) : (current + direction + matches.length) % matches.length;
    this.current.set(index);
    this.reveal(matches[index] as string);
    return true;
  }

  /** Opens everything `id` is in, and puts the cursor on it. */
  reveal(id: string): void {
    const open = new Set(this.expanded());
    for (let at = id.lastIndexOf('/'); at >= 0; at = id.lastIndexOf('/', at - 1)) {
      open.add(id.slice(0, at));
      if (at === 0) {
        break;
      }
    }
    open.add('');
    this.expanded.set(open);
    this.focusedId.set(id);
  }

  /* -- editing (§5.2) ------------------------------------------------------ */

  /**
   * Starts typing into the key or the value of row `id` — a key of an
   * object, a value that is no object or array. `false` when it cannot be.
   */
  beginEdit(id: string, part: 'key' | 'value'): boolean {
    const row = this.rows().find((candidate) => candidate.id === id);
    if (row === undefined || (part === 'key' && (row.key === null || row.inArray)) || (part === 'value' && row.size > 0) || (part === 'value' && !('scalar' in row))) {
      return false;
    }
    const draft = part === 'key' ? (row.key as string) : typeof row.scalar === 'string' ? row.scalar : JSON.stringify(row.scalar);
    this.focusedId.set(id);
    this.editing.set({ id, part, draft });
    return true;
  }

  setDraft(draft: string): void {
    const editing = this.editing();
    if (editing !== null) {
      const { error: _error, ...rest } = editing;
      this.editing.set({ ...rest, draft });
    }
  }

  cancelEdit(): void {
    this.editing.set(null);
  }

  /**
   * The draft as an edit, or `null` — nothing changed, or (the draft kept,
   * with why) it cannot be: a key another key of the object has, a value of a
   * non-string that is no JSON value. A string stays a string; anything else
   * is read as JSON, so `"1"` makes a string of a number.
   */
  commitEdit(): UiJsonEdit | null {
    const editing = this.editing();
    const row = editing === null ? undefined : this.rows().find((candidate) => candidate.id === editing.id);
    if (editing === null || row === undefined) {
      this.editing.set(null);
      return null;
    }
    if (editing.part === 'key') {
      if (editing.draft === row.key) {
        this.editing.set(null);
        return null;
      }
      const parent = valueAt(this.value(), row.id.slice(0, row.id.lastIndexOf('/')));
      if (Object.hasOwn(parent as object, editing.draft)) {
        this.editing.set({ ...editing, error: `There is a key "${editing.draft}" already` });
        return null;
      }
      this.editing.set(null);
      this.renamed(row.id, `${row.id.slice(0, row.id.lastIndexOf('/'))}/${escapePointer(editing.draft)}`);
      return { pointer: row.id, key: editing.draft };
    }
    let value: string | number | boolean | null;
    if (typeof row.scalar === 'string') {
      value = editing.draft;
    } else {
      try {
        const parsed: unknown = JSON.parse(editing.draft);
        if (isContainer(parsed)) {
          throw new SyntaxError('container');
        }
        value = parsed as string | number | boolean | null;
      } catch {
        this.editing.set({ ...editing, error: 'Not a JSON value — a number, true, false, null, or a "string"' });
        return null;
      }
    }
    this.editing.set(null);
    return value === row.scalar ? null : { pointer: row.id, value };
  }

  /** A key renamed: what was open under it stays open, and the cursor stays on it. */
  private renamed(from: string, to: string): void {
    const move = (id: string): string => (id === from || id.startsWith(`${from}/`) ? to + id.slice(from.length) : id);
    this.expanded.set(new Set([...this.expanded()].map(move)));
    this.focusedId.set(move(this.focusedId()));
  }

  private setOpen(id: string, open: boolean): void {
    const next = new Set(this.expanded());
    if (open) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.expanded.set(next);
  }
}

/** `text` cut where `query` is in it, case ignored: the parts, and which of them match. */
export function matchParts(text: string, query: string): readonly { readonly text: string; readonly match: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [{ text, match: false }];
  }
  const parts: { text: string; match: boolean }[] = [];
  const haystack = text.toLowerCase();
  let at = 0;
  for (let found = haystack.indexOf(needle); found !== -1; found = haystack.indexOf(needle, at)) {
    if (found > at) {
      parts.push({ text: text.slice(at, found), match: false });
    }
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    at = found + needle.length;
  }
  if (at < text.length) {
    parts.push({ text: text.slice(at), match: false });
  }
  return parts;
}

function kindOf(value: unknown): UiJsonKind {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  switch (typeof value) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'null';
  }
}

function isContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function childrenOf(value: unknown): readonly (readonly [string, unknown])[] {
  if (Array.isArray(value)) {
    return value.map((child, index) => [String(index), child] as const);
  }
  return isContainer(value) ? Object.entries(value as Record<string, unknown>) : [];
}

function previewOf(value: unknown, kind: UiJsonKind, open: boolean): string {
  switch (kind) {
    case 'object':
      return open ? '{' : '{…}';
    case 'array':
      return open ? '[' : '[…]';
    case 'string': {
      const text = JSON.stringify(value);
      return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…"` : text;
    }
    default:
      return String(value);
  }
}

/** How many values `value` holds, counting no further than `limit`. */
function countValues(value: unknown, limit: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && count < limit) {
    const next = stack.pop();
    count++;
    for (const [, child] of childrenOf(next)) {
      stack.push(child);
    }
  }
  return count;
}

/** A key as RFC 6901 writes it in a pointer. */
function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapePointer(key: string): string {
  return key.replaceAll('~1', '/').replaceAll('~0', '~');
}

function valueAt(value: unknown, pointer: string): unknown {
  let current = value;
  for (const raw of pointer === '' ? [] : pointer.slice(1).split('/')) {
    current = (current as Record<string, unknown> | null)?.[unescapePointer(raw)];
  }
  return current;
}

/** `/items/0/name` of `value` as `$.items[0].name`. */
function pathOf(pointer: string, value: unknown): string {
  if (pointer === '') {
    return '$';
  }
  let path = '$';
  let current: unknown = value;
  for (const raw of pointer.slice(1).split('/')) {
    const key = unescapePointer(raw);
    if (Array.isArray(current)) {
      path += `[${key}]`;
      current = current[Number(key)];
    } else {
      path += /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
      current = (current as Record<string, unknown> | null)?.[key];
    }
  }
  return path;
}
