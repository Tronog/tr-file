import type { PanelSort } from '../panel-group.model';
import { compareKeys, type SortKeys } from './listing-order';

/**
 * Sorts a large folder off the UI thread (PRD 004, §3.1): a million entries
 * are seconds of comparisons, which on the page would freeze it once a second
 * while the folder's details come in.
 *
 * It is handed the keys, not the entries — the names as one `\0`-joined
 * string (one copy, not a million), and only the columns the sort reads, as
 * typed arrays moved rather than copied — and answers with the order: the
 * entries' indexes, sorted, likewise moved. The comparison is
 * `listing-order.ts`'s own, so the worker and the page can never disagree.
 */
export interface ListingOrderAsk {
  readonly id: number;
  readonly sort: PanelSort;
  /** Every name, joined with `\0` — the one character no name has. */
  readonly names: string;
  /** `1` for a folder (or a link to one). */
  readonly folder: Uint8Array;
  /** Present when the sort is by size. */
  readonly size: Float64Array | null;
  /** Present when the sort is by date; minus infinity while not known. */
  readonly time: Float64Array | null;
  /** Present when the sort is by type: an index into `labels` per entry. */
  readonly labelIds: Uint16Array | null;
  readonly labels: readonly string[];
}

export interface ListingOrderAnswer {
  readonly id: number;
  /** Indexes into what was asked about, in order. */
  readonly order: Uint32Array;
}

interface Keyed extends SortKeys {
  readonly index: number;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ListingOrderAsk>) => void) | null;
  postMessage(message: ListingOrderAnswer, transfer: Transferable[]): void;
};

scope.onmessage = ({ data }) => {
  const count = data.folder.length;
  const names = count === 0 ? [] : data.names.split('\0');
  const keyed: Keyed[] = new Array(count);
  for (let index = 0; index < count; index++) {
    keyed[index] = {
      index,
      name: names[index] ?? '',
      folder: data.folder[index] === 1,
      size: data.size?.[index] ?? 0,
      time: data.time?.[index] ?? 0,
      label: data.labelIds === null ? '' : (data.labels[data.labelIds[index] ?? 0] ?? ''),
    };
  }
  keyed.sort(compareKeys(data.sort));
  const order = new Uint32Array(count);
  for (let position = 0; position < count; position++) {
    order[position] = (keyed[position] as Keyed).index;
  }
  scope.postMessage({ id: data.id, order }, [order.buffer]);
};
