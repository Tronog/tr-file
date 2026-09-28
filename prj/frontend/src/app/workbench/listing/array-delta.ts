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
  /** The array this one differs from; same length. */
  readonly from: readonly T[];
  /** The positions that hold a different value. */
  readonly changed: readonly number[];
}

const deltas = new WeakMap<readonly unknown[], ArrayDelta<unknown>>();

/** Records that `next` is `from` with only `changed` positions replaced. */
export function recordDelta<T>(next: readonly T[], from: readonly T[], changed: readonly number[]): void {
  if (next.length === from.length) {
    deltas.set(next, { from, changed });
  }
}

/** How `next` differs from the array it was made from, if it was recorded. */
export function deltaOf<T>(next: readonly T[]): ArrayDelta<T> | undefined {
  return deltas.get(next) as ArrayDelta<T> | undefined;
}
