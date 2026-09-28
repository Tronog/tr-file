import { effect, signal, untracked } from '@angular/core';
import type { FsEntry } from '../../file-system/file-system.model';
import { isFolder } from '../../file-system/fs-entry-kind';
import type { PanelSort } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';
import { deltaOf, recordDelta } from './array-delta';
import { sortEntries, timeOf } from './listing-order';
import type { ListingOrderAnswer, ListingOrderAsk } from './listing-order.worker';

/** A folder with this many entries is sorted in a Web Worker; one with fewer, as ever, on the spot (PRD 004, §3.1). */
export const WORKER_SORT_THRESHOLD = 1000;

/** A worker's answer: the order of `source`, as indexes into it. */
interface Order {
  readonly source: readonly FsEntry[];
  readonly order: Uint32Array;
}

/** The part of a `Worker` this uses; specs hand in their own. */
export interface ListingOrderWorker {
  onmessage: ((event: MessageEvent<ListingOrderAnswer>) => void) | null;
  postMessage(message: ListingOrderAsk, transfer: Transferable[]): void;
}

/** Which order of a folder; the path goes last, and a sort's words have no `:`, so no two folders share one. */
const keyOf = (path: string, sort: PanelSort): string => `${sort.key}:${sort.direction}:${path}`;
const sortKeyOf = (sort: PanelSort): string => `${sort.key}:${sort.direction}`;

/** A folder's orders: one per sort, and the one that came last. */
interface FolderOrders {
  readonly bySort: ReadonlyMap<string, Order>;
  readonly latest: Order;
}

/**
 * The order of large folders, worked out in a Web Worker (PRD 004, §3.1).
 *
 * Sorting a million entries is seconds of the UI thread, and a large folder
 * changes once a second while its details come in. So a folder at or past
 * `WORKER_SORT_THRESHOLD` is sorted in `listing-order.worker.ts`, asked by an
 * `effect` whenever a folder on screen — in a panel, open in a tree, holding
 * the image a panel shows — has entries its order was not worked out for.
 * `sorted` only reads what came back: it lays the last order over the new
 * entries while they are the same entries (their details filled in), and a
 * new sort shows the folder's last order until its own arrives. Until there
 * is any, `ready` is false and the panel says it is sorting (the entries are
 * not shown in the order the disk keeps them, to jump a moment later).
 *
 * A small folder, or a page without workers (specs), is sorted on the spot.
 */
export class ListingOrderFeature {
  private readonly orders = signal<ReadonlyMap<string, FolderOrders>>(new Map());
  /** What each order was last asked for — so an unchanged folder is not asked about again. */
  private readonly asked = new Map<string, readonly FsEntry[]>();
  private readonly waiting = new Map<number, { readonly path: string; readonly sort: PanelSort; readonly source: readonly FsEntry[] }>();
  private nextId = 0;
  private worker: ListingOrderWorker | null | undefined;
  /** The last order laid over entries, kept: `sorted` is read several times a render. */
  private laid: { readonly entries: readonly FsEntry[]; readonly order: Order; readonly result: readonly FsEntry[] } | null = null;

  constructor(
    private readonly parent: WorkbenchService,
    private readonly createWorker: () => ListingOrderWorker | null = ListingOrderFeature.defaultWorker,
  ) {
    effect(() => {
      const wanted = this.parent.fileBrowserFt.ordersWanted();
      for (const { path, sort } of wanted) {
        const entries = this.parent.fsDataFt.entries(path);
        const key = keyOf(path, sort);
        if (entries.length < WORKER_SORT_THRESHOLD || this.asked.get(key) === entries) {
          continue;
        }
        if (this.carries(key, sort, entries)) {
          this.asked.set(key, entries);
        } else {
          untracked(() => this.ask(path, sort, entries));
        }
      }
      untracked(() => this.forgetAllBut(wanted));
    });
  }

  /**
   * `entries` of `path` in `sort`'s order: on the spot for a small folder,
   * else the worker's latest — laid over these entries when they are the ones
   * it sorted, give or take their details, and as they are before it has
   * answered at all.
   */
  sorted(path: string, entries: readonly FsEntry[], sort: PanelSort, typeLabel: (entry: FsEntry) => string): readonly FsEntry[] {
    if (entries.length < WORKER_SORT_THRESHOLD || this.workerOrNull() === null) {
      return sortEntries(entries, sort, typeLabel);
    }
    const order = this.usableOrder(path, entries, sort);
    if (order === undefined) {
      return entries;
    }
    const laid = this.laid;
    if (laid !== null && laid.entries === entries && laid.order === order) {
      return laid.result;
    }
    // The entries last laid out, a few of them described since: those few put in their places.
    const delta = deltaOf(entries);
    if (laid !== null && laid.order === order && delta !== undefined && delta.from === laid.entries) {
      const positions = this.positionsIn(order);
      const result = laid.result.slice();
      const changed: number[] = [];
      for (const index of delta.changed) {
        const at = positions[index] as number;
        result[at] = entries[index] as FsEntry;
        changed.push(at);
      }
      recordDelta(result, laid.result, changed);
      this.laid = { entries, order, result };
      return result;
    }
    const result = Array.from(order.order, (index) => entries[index] as FsEntry);
    this.laid = { entries, order, result };
    return result;
  }

  /**
   * Whether the order worked out for the entries last asked about holds for
   * these too, without asking again: they are the same entries, a few of them
   * described since (PRD 004, §3.1), and the sort is by name — which a size or
   * a date cannot move — and none of them turned out a folder, or stopped
   * being one (a link, once it is known where it leads).
   */
  private carries(key: string, sort: PanelSort, entries: readonly FsEntry[]): boolean {
    const delta = deltaOf(entries);
    if (sort.key !== 'name' || delta === undefined || this.asked.get(key) !== delta.from) {
      return false;
    }
    return delta.changed.every((index) => isFolder(delta.from[index] as FsEntry) === isFolder(entries[index] as FsEntry));
  }

  /** Where each entry lands in `order`: the inverse of it, worked out once per order. */
  private positionsIn(order: Order): Int32Array {
    let positions = this.inverses.get(order);
    if (positions === undefined) {
      positions = new Int32Array(order.order.length);
      order.order.forEach((index, at) => {
        (positions as Int32Array)[index] = at;
      });
      this.inverses.set(order, positions);
    }
    return positions;
  }

  private readonly inverses = new WeakMap<Order, Int32Array>();

  /** A listing's names, joined for the worker once per set of names — details do not change them. */
  private joinedNames(entries: readonly FsEntry[]): string {
    let joined = this.joined.get(entries);
    if (joined === undefined) {
      const delta = deltaOf(entries);
      joined = (delta === undefined ? undefined : this.joined.get(delta.from)) ?? entries.map((entry) => entry.name).join('\0');
      this.joined.set(entries, joined);
    }
    return joined;
  }

  private readonly joined = new WeakMap<readonly FsEntry[], string>();

  /**
   * Whether `entries` can be shown in some order worked out for them — or are
   * small enough to sort on the spot. A large folder with none yet (its first
   * reading, or its entries changed in number) is better not shown at all than
   * shown in the order the disk keeps them, only to jump a moment later.
   */
  ready(path: string, entries: readonly FsEntry[], sort: PanelSort): boolean {
    return entries.length < WORKER_SORT_THRESHOLD || this.workerOrNull() === null || this.usableOrder(path, entries, sort) !== undefined;
  }

  /**
   * The order to lay over `entries`: the one worked out for this sort, else —
   * while that is being worked out, a column header having just been clicked —
   * the folder's last order in any sort, so the screen stays as it was rather
   * than jumping to no order at all. Only an order of these same entries will
   * do: one of a different number of them would point at the wrong ones.
   */
  private usableOrder(path: string, entries: readonly FsEntry[], sort: PanelSort): Order | undefined {
    const folder = this.orders().get(path);
    if (folder === undefined) {
      return undefined;
    }
    const exact = folder.bySort.get(sortKeyOf(sort));
    if (exact !== undefined && exact.source.length === entries.length) {
      return exact;
    }
    return folder.latest.source.length === entries.length ? folder.latest : undefined;
  }

  /**
   * Lets go of the orders of folders — and of sorts — no longer on screen: each
   * holds the listing it was worked out for, a million entries of it.
   */
  private forgetAllBut(wanted: readonly { readonly path: string; readonly sort: PanelSort }[]): void {
    const keys = new Set(wanted.map(({ path, sort }) => keyOf(path, sort)));
    for (const key of [...this.asked.keys()]) {
      if (!keys.has(key)) {
        this.asked.delete(key);
      }
    }
    const current = this.orders();
    let next: Map<string, FolderOrders> | null = null;
    for (const [path, folder] of current) {
      const bySort = new Map([...folder.bySort].filter(([sortKey]) => keys.has(`${sortKey}:${path}`)));
      if (bySort.size === folder.bySort.size) {
        continue;
      }
      next ??= new Map(current);
      if (bySort.size === 0) {
        next.delete(path);
      } else {
        next.set(path, { bySort, latest: folder.latest });
      }
    }
    if (next !== null) {
      this.orders.set(next);
    }
  }

  /** Posts `entries`' keys to the worker, moved rather than copied. */
  private ask(path: string, sort: PanelSort, entries: readonly FsEntry[]): void {
    const worker = this.workerOrNull();
    if (worker === null) {
      return;
    }
    const key = keyOf(path, sort);
    const id = this.nextId++;
    const count = entries.length;
    const folder = new Uint8Array(count);
    const size = sort.key === 'size' ? new Float64Array(count) : null;
    const time = sort.key === 'modified' ? new Float64Array(count) : null;
    const labelIds = sort.key === 'type' ? new Uint16Array(count) : null;
    const labels: string[] = [];
    const labelIndex = new Map<string, number>();
    for (let index = 0; index < count; index++) {
      const entry = entries[index] as FsEntry;
      folder[index] = isFolder(entry) ? 1 : 0;
      if (size !== null) {
        size[index] = entry.size;
      }
      if (time !== null) {
        time[index] = this.timeOf(entry);
      }
      if (labelIds !== null) {
        const label = this.parent.fileViewModel.typeLabel(entry);
        let at = labelIndex.get(label);
        if (at === undefined) {
          at = labels.push(label) - 1;
          labelIndex.set(label, at);
        }
        labelIds[index] = at;
      }
    }
    this.asked.set(key, entries);
    this.waiting.set(id, { path, sort, source: entries });
    const transfer = [folder.buffer, size?.buffer, time?.buffer, labelIds?.buffer].filter((buffer): buffer is ArrayBuffer => buffer !== undefined);
    worker.postMessage({ id, sort, names: this.joinedNames(entries), folder, size, time, labelIds, labels }, transfer);
  }

  private answered(answer: ListingOrderAnswer): void {
    const asked = this.waiting.get(answer.id);
    this.waiting.delete(answer.id);
    if (asked === undefined) {
      return;
    }
    // An answer overtaken by a newer question is still better than none, but never replaces a newer one.
    const sortKey = sortKeyOf(asked.sort);
    const folder = this.orders().get(asked.path);
    const latest = this.asked.get(keyOf(asked.path, asked.sort)) === asked.source;
    if (folder?.bySort.has(sortKey) && !latest) {
      return;
    }
    const order: Order = { source: asked.source, order: answer.order };
    const bySort = new Map(folder?.bySort ?? []).set(sortKey, order);
    this.orders.update((orders) => new Map(orders).set(asked.path, { bySort, latest: order }));
  }

  /** When an entry was changed, parsed once per entry object: a million `Date.parse`s a second add up. */
  private readonly times = new WeakMap<FsEntry, number>();

  private timeOf(entry: FsEntry): number {
    let time = this.times.get(entry);
    if (time === undefined) {
      time = timeOf(entry);
      this.times.set(entry, time);
    }
    return time;
  }

  private workerOrNull(): ListingOrderWorker | null {
    if (this.worker === undefined) {
      this.worker = this.createWorker();
      if (this.worker !== null) {
        this.worker.onmessage = ({ data }) => this.answered(data);
      }
    }
    return this.worker;
  }

  private static defaultWorker(): ListingOrderWorker | null {
    if (typeof Worker === 'undefined') {
      return null;
    }
    try {
      return new Worker(new URL('./listing-order.worker', import.meta.url), { type: 'module' }) as unknown as ListingOrderWorker;
    } catch {
      return null;
    }
  }
}
