/**
 * Keyboard helpers shared by the two panel bodies — `UiFileList` and
 * `UiIconView` (PRD 001, Section 6.2).
 *
 * Both are flat lists of entries whose only difference is how they are laid
 * out, so the parts that are genuinely about *navigation* rather than about
 * markup live here: type-to-find, and how far a page key travels.
 */

/** How long a type-to-find prefix survives between keystrokes, in ms. */
const TYPEAHEAD_TIMEOUT = 700;

/** Rows a page key travels when no scroll container can be measured. */
const DEFAULT_PAGE = 10;

/**
 * Whether a key should extend the type-to-find prefix: a single printable
 * character, unmodified. `Space` is excluded because it selects.
 */
export function isTypeaheadKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    event.key !== ' ' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/**
 * Type-to-find, as every file manager has it: letters typed in quick
 * succession build a prefix and jump to the first entry that starts with it,
 * while one letter pressed repeatedly cycles through the entries beginning
 * with that letter. The search wraps, so it always finds a match if one
 * exists anywhere in the list.
 *
 * Kept as a plain class rather than a signal: the buffer is transient gesture
 * state that nothing renders.
 */
export class UiTypeahead {
  private prefix = '';
  private at = 0;

  /**
   * Index `labels` should jump to after `key`, or `-1` when nothing matches.
   * `from` is the entry focus sits on; `now` is injectable so tests need no
   * timers.
   */
  match(key: string, labels: readonly string[], from: number, now: number = Date.now()): number {
    if (labels.length === 0) {
      return -1;
    }

    const letter = key.toLowerCase();
    const expired = now - this.at > TYPEAHEAD_TIMEOUT;
    this.at = now;
    this.prefix = expired ? letter : this.prefix + letter;

    // One letter, pressed once or repeatedly, cycles; anything longer is a
    // real prefix and may well match the entry focus is already on.
    const cycling = [...this.prefix].every((character) => character === letter);
    const needle = cycling ? letter : this.prefix;
    const start = cycling ? from + 1 : from;
    const count = labels.length;

    for (let step = 0; step < count; step += 1) {
      const index = (((start + step) % count) + count) % count;
      if (labels[index]?.toLowerCase().startsWith(needle)) {
        return index;
      }
    }

    return -1;
  }
}

/**
 * How many entries `PageUp`/`PageDown` should travel: as many rows as fit in
 * the scroll container around `entry`. Falls back to a fixed ten when nothing
 * can be measured, which is what jsdom and a zero-height layout both give.
 */
export function pageStep(entry: HTMLElement | undefined): number {
  if (!entry) {
    return DEFAULT_PAGE;
  }

  const height = entry.getBoundingClientRect().height;
  const viewport = scrollParent(entry)?.clientHeight ?? 0;
  if (height === 0 || viewport === 0) {
    return DEFAULT_PAGE;
  }

  return Math.max(1, Math.floor(viewport / height));
}

/** The nearest ancestor that actually scrolls, or `null`. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight) {
      return node;
    }
  }

  return null;
}
