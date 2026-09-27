import type { UiSelectionChange } from '../models';

/**
 * Multi-selection, as every file manager has it (PRD 004, §1.2) — shared by
 * `UiFileList` (the details and tree views) and `UiIconView`.
 *
 * - `replace` — the entry alone: a plain click, a plain arrow key.
 * - `toggle` — flip one entry in or out: `Ctrl`/`⌘`-click, `Ctrl`+`Space`.
 * - `range` — everything from the anchor to the entry: `Shift`-click,
 *   `Shift` with a movement key.
 * - `range-add` — the same range, added to what is selected: `Ctrl`+`Shift`-click.
 * - `focus` — move the cursor, leave the selection: `Ctrl` with a movement key.
 * - `all` — every entry: `Ctrl`+`A`.
 * - `toggle-all` — every entry, or none when every one already is: `*` (PRD 004, §2).
 *
 * The *anchor* is where a range starts: the last entry picked by a replace or
 * a toggle. It is transient gesture state, like a type-to-find prefix, so it
 * lives here rather than in the application's model; a list whose anchor is no
 * longer in it starts ranges from the cursor instead.
 */
export type UiSelectMode = 'replace' | 'toggle' | 'range' | 'range-add' | 'focus' | 'all' | 'toggle-all';

/**
 * Midnight Commander's selection keys (PRD 004, §2), on a row or a tile:
 *
 * - `mark` — `Insert`: flip the entry in or out, and move on to the next.
 * - `toggle-all` — `*`: select everything, or nothing once everything is.
 * - `select-pattern` / `unselect-pattern` — `+` / `-`: add or take away
 *   the entries whose names match a pattern, which the application asks for.
 *
 * The first two are the list's own; the pattern keys leave as a `UiPanelKey`.
 */
export type UiMarkKey = 'mark' | 'toggle-all' | 'select-pattern' | 'unselect-pattern';

/**
 * The mark key `event` is, or `null`. `*`, `+` and `-` are read by the
 * character, so the numeric keypad's count too, and whatever `Shift` it took
 * to type them; `typing` says a name is being typed, which they are then part of.
 */
export function markKey(event: KeyboardEvent, typing: boolean): UiMarkKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  if (event.key === 'Insert') {
    return event.shiftKey ? null : 'mark';
  }
  if (typing) {
    return null;
  }
  switch (event.key) {
    case '*':
      return 'toggle-all';
    case '+':
      return 'select-pattern';
    case '-':
      return 'unselect-pattern';
    default:
      return null;
  }
}

/** The mode a click means, from the keys held while it was made. */
export function clickMode(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): UiSelectMode {
  const toggle = event.ctrlKey || event.metaKey;
  if (event.shiftKey) {
    return toggle ? 'range-add' : 'range';
  }
  return toggle ? 'toggle' : 'replace';
}

/** The mode a movement key means: `Shift` extends, `Ctrl` only moves the cursor. */
export function moveMode(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): UiSelectMode {
  if (event.shiftKey) {
    return 'range';
  }
  return event.ctrlKey || event.metaKey ? 'focus' : 'replace';
}

export class UiListSelection {
  private anchorId: string | null = null;

  /**
   * The selection after picking `target` in `mode`.
   *
   * `ids` is every entry in list order, `selected` what is selected now and
   * `cursor` the entry the cursor was on, which a range starts from when there
   * is no anchor yet. The answer lists the selection in list order, whatever
   * order it was picked in.
   */
  pick(options: {
    readonly ids: readonly string[];
    readonly selected: ReadonlySet<string>;
    readonly cursor: string | null;
    readonly target: string;
    readonly mode: UiSelectMode;
  }): UiSelectionChange {
    const { ids, selected, target, mode } = options;
    const inOrder = (set: ReadonlySet<string>): readonly string[] => ids.filter((id) => set.has(id));

    switch (mode) {
      case 'replace':
        this.anchorId = target;
        return { selected: [target], focused: target };

      case 'toggle': {
        this.anchorId = target;
        const next = new Set(selected);
        if (next.has(target)) {
          next.delete(target);
        } else {
          next.add(target);
        }
        return { selected: inOrder(next), focused: target };
      }

      case 'range':
      case 'range-add': {
        const anchor = this.anchorIn(ids, options.cursor ?? target);
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(target);
        const span = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
        const next = mode === 'range-add' ? new Set([...selected, ...span]) : new Set(span);
        return { selected: inOrder(next), focused: target };
      }

      case 'focus':
        return { selected: inOrder(selected), focused: target };

      case 'all':
        return { selected: [...ids], focused: options.cursor ?? target };

      case 'toggle-all':
        return { selected: ids.every((id) => selected.has(id)) ? [] : [...ids], focused: options.cursor ?? target };
    }
  }

  /**
   * `Insert` (PRD 004, §2): `target` — the entry the cursor is on — flips in
   * or out of the selection, and the cursor moves on to `next` without
   * touching the rest.
   *
   * Selection follows the cursor here, so an entry the cursor merely stands on
   * is already selected. That lone entry is *kept*, not dropped: the first
   * `Insert` on a fresh list marks the entry it is on, as it does in Midnight
   * Commander. `Ctrl`+`Space` still takes it out.
   */
  mark(options: {
    readonly ids: readonly string[];
    readonly selected: ReadonlySet<string>;
    readonly target: string;
    readonly next: string;
  }): UiSelectionChange {
    const { ids, selected, target } = options;
    const next = new Set(selected);
    const lone = selected.size === 1 && selected.has(target);
    if (selected.has(target) && !lone) {
      next.delete(target);
    } else {
      next.add(target);
    }
    this.anchorId = target;
    return { selected: ids.filter((id) => next.has(id)), focused: options.next };
  }

  /** Forgets the anchor — for a gesture, like a box selection, that sets its own. */
  setAnchor(id: string | null): void {
    this.anchorId = id;
  }

  /** The anchor, if it is still one of `ids`; otherwise `fallback`, which becomes the anchor. */
  private anchorIn(ids: readonly string[], fallback: string): string {
    if (this.anchorId === null || !ids.includes(this.anchorId)) {
      this.anchorId = fallback;
    }
    return this.anchorId;
  }
}
