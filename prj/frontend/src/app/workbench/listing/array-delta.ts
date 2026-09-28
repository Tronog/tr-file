/**
 * What changed between two arrays of the same length, where only some
 * positions hold a new value — a large folder's listing as its details come
 * in (PRD 004, §3.1): the same names at the same places, a batch of them
 * described. Each stage that derives an array from another (the listing
 * without its hidden entries, in the panel's order, as rows) records how its
 * output changed, so the next stage can redo the positions that changed
 * rather than a million that did not.
 *
 * Recorded against the new array, which is its key and holds it alive no
 * longer than the array itself lives.
 */
export interface ArrayDelta<T> {
  /** The array this one differs from — as long, or shorter: what lies past its end was added since. */
  readonly from: readonly T[];
  /** The positions, within `from`'s length, that hold a different value. */
  readonly changed: readonly number[];
}

const deltas = new WeakMap<readonly unknown[], ArrayDelta<unknown>>();

/**
 * Which line of arrays each belongs to, and how far along it: what
 * `descendsFrom` asks. Kept apart from the deltas so that telling descent
 * never holds an older array alive — a delta holds only the one before it,
 * and letting go of the one before that when a new delta is recorded keeps a
 * large folder's once-a-second listings from piling up in memory.
 */
const lines = new WeakMap<readonly unknown[], { readonly line: object; readonly generation: number }>();

/**
 * Records that `next` is `from` with only `changed` positions replaced — and,
 * past `from`'s end, what was added since: a large folder's names come in as
 * it is read (PRD 004, §3.1).
 */
export function recordDelta<T>(next: readonly T[], from: readonly T[], changed: readonly number[]): void {
  if (next.length < from.length) {
    return;
  }
  deltas.set(next, { from, changed });
  // One step back is all anyone reads: the step before that would only hold old arrays alive.
  deltas.delete(from);
  let line = lines.get(from);
  if (line === undefined) {
    line = { line: {}, generation: 0 };
    lines.set(from, line);
  }
  lines.set(next, { line: line.line, generation: line.generation + 1 });
}

/**
 * Whether `next` was made from `from` by a chain of recorded deltas — the
 * same entries at the same places, some replaced, some added after — so what
 * was worked out for `from` by position still holds for the start of `next`.
 */
export function descendsFrom<T>(next: readonly T[], from: readonly T[]): boolean {
  if (next === from) {
    return true;
  }
  const later = lines.get(next);
  const earlier = lines.get(from);
  return later !== undefined && earlier !== undefined && later.line === earlier.line && later.generation > earlier.generation && next.length >= from.length;
}

/** How `next` differs from the array it was made from, if it was recorded. */
export function deltaOf<T>(next: readonly T[]): ArrayDelta<T> | undefined {
  return deltas.get(next) as ArrayDelta<T> | undefined;
}
