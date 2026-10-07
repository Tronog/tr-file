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
}

/** A row drawn of a string is cut here; the file has the rest. */
const MAX_PREVIEW = 300;

/** A document of up to this many values opens two levels deep; anything larger, one. */
const SMALL_DOCUMENT = 400;

/**
 * The JSON viewer's model (PRD 005, §5): the document, which of its objects
 * and arrays are open, and the row the keyboard is on — flattened into the
 * rows on show, walking only into what is open.
 *
 * Provided by `UiJsonTree`, one per tree, like the image viewer's.
 */
@Service()
export class UiJsonTreeService {
  private readonly value = signal<unknown>(null);
  private readonly expanded = signal<ReadonlySet<string>>(new Set(['']));
  readonly focusedId = signal('');

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

  /** A new document: open at the top — two levels deep when small — with the keyboard on its first row. */
  setValue(value: unknown): void {
    this.value.set(value);
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

/** `/items/0/name` of `value` as `$.items[0].name`. */
function pathOf(pointer: string, value: unknown): string {
  if (pointer === '') {
    return '$';
  }
  let path = '$';
  let current: unknown = value;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
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
