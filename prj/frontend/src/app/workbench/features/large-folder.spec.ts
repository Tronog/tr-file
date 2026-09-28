import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsEntry, FsListingProgress } from '../../file-system/file-system.model';
import { deltaOf, recordDelta } from '../listing/array-delta';
import { ListingOrderFeature, WORKER_SORT_THRESHOLD, type ListingOrderWorker } from '../listing/listing-order.feature';
import type { ListingOrderAnswer, ListingOrderAsk } from '../listing/listing-order.worker';
import { detailsUrl, fsDetails, fsEntry, fsEnvelope, listUrl, settled } from '../testing/fs-fixtures';
import { provideOnePanel } from '../testing/one-panel';
import { WorkbenchService } from '../workbench.service';

/**
 * PRD 004, §3.1 — a folder of a thousand entries or more: the backend reads it
 * by stages, and the panel follows — how many, then the names, shown without
 * details, then the details, once a second — while a Web Worker keeps it in
 * order.
 */
describe('A large folder', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let clock: number;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    // A clock the reading's pauses move on, so "once a second" is under the spec's control.
    clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    workbench.fsDataFt.wait = async (ms) => {
      clock += Math.max(ms, 1);
    };
  });

  afterEach(() => vi.restoreAllMocks());

  const progress = (answer: Partial<FsListingProgress>): FsListingProgress => ({
    path: '',
    total: null,
    names: [],
    namesDone: false,
    details: [],
    gone: [],
    done: false,
    ...answer,
  });

  /** Answers the next question about the reading, checking where it asked from. */
  async function answer(namesFrom: number, detailsFrom: number, body: FsListingProgress): Promise<void> {
    await settled();
    const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/list-progress'));
    const params = new URL(request.request.urlWithParams, 'http://x').searchParams;
    expect(params.get('token')).toBe('t1');
    expect([params.get('namesFrom'), params.get('detailsFrom')]).toEqual([`${namesFrom}`, `${detailsFrom}`]);
    request.flush(fsEnvelope(body));
    await settled();
  }

  const browser = () => workbench.fileBrowserFt.browser(workbench.activeGroupId());

  it('is counted, named, shown without details, then described — the panel following each stage', async () => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1' } }));
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));

    await answer(0, 0, progress({}));
    expect(browser()?.empty?.title).toBe('Counting the entries of this folder…');

    clock += 1000;
    await answer(0, 0, progress({ total: 3, names: [{ name: 'b.txt', type: 'file' }] }));
    expect(browser()?.empty?.title).toBe('Reading 3 entries…');
    expect(browser()?.empty?.hint).toBe('1 names so far');
    expect(browser()?.rows).toEqual([]);

    // Every name in: shown at once, without sizes or dates, in the panel's order.
    await answer(1, 0, progress({ total: 3, names: [{ name: 'a.txt', type: 'file' }, { name: 'docs', type: 'directory' }], namesDone: true }));
    expect(browser()?.rows.map((row) => row.name)).toEqual(['docs', 'a.txt', 'b.txt']);
    expect(browser()?.rows.find((row) => row.name === 'a.txt')?.cells).toMatchObject({ size: '', modified: '', type: 'TXT' });
    expect(browser()?.summary).toBe('3 items · details 0%');
    expect(workbench.editorGroupsFt.group(workbench.activeGroupId())?.loading).toBe(true);

    const detail = (index: number, name: string, size: number) => {
      const { name: _name, path: _path, hidden: _hidden, ...known } = fsEntry(name, { size });
      return { index, ...known };
    };
    clock += 1000;
    await answer(3, 0, progress({ total: 3, namesDone: true, details: [detail(0, 'b.txt', 2048)] }));
    expect(browser()?.rows.find((row) => row.name === 'b.txt')?.cells['size']).toBe('2.0 KB');
    expect(browser()?.summary).toBe('3 items · details 33%');

    // The last detail, and one entry gone meanwhile: done, and ready.
    clock += 1000;
    await answer(3, 1, progress({ total: 3, namesDone: true, details: [detail(1, 'a.txt', 10)], gone: [2], done: true }));
    expect(browser()?.rows.map((row) => row.name)).toEqual(['a.txt', 'b.txt']);
    expect(browser()?.summary).toBe('2 items');
    expect(workbench.fsDataFt.listingState('')?.status).toBe('ready');
    expect(workbench.editorGroupsFt.group(workbench.activeGroupId())?.loading).toBeUndefined();
    http.match(() => true);
  });

  it('makes each update from the last where only details came — the same result as made afresh', async () => {
    workbench.showHidden.set(false);
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1' } }));
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
    const names = ['c', '.hidden', 'a', 'b'].map((name) => ({ name, type: 'file' as const }));
    await answer(0, 0, progress({ total: 4, names, namesDone: true }));
    const before = workbench.fsDataFt.listingState('')?.listing?.entries as readonly FsEntry[];
    const shownBefore = workbench.fsDataFt.entries('');
    expect(shownBefore.map((entry) => entry.name)).toEqual(['c', 'a', 'b']);
    expect(browser()?.rows.map((row) => row.name)).toEqual(['a', 'b', 'c']);

    const detail = (index: number, size: number) => ({ index, type: 'file' as const, size, modifiedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' });
    clock += 1000;
    await answer(4, 0, progress({ total: 4, namesDone: true, details: [detail(2, 5), detail(1, 7)] }));

    const after = workbench.fsDataFt.listingState('')?.listing?.entries as readonly FsEntry[];
    // Recorded as the last listing with two entries replaced…
    expect(deltaOf(after)).toEqual({ from: before, changed: expect.arrayContaining([1, 2]) });
    // …and every stage made from its last result agrees with one made afresh.
    const shown = workbench.fsDataFt.entries('');
    expect(shown).toEqual(after.filter((entry) => !entry.hidden));
    expect(deltaOf(shown)?.from).toBe(shownBefore);
    expect(workbench.fsDataFt.entryAt('a')?.size).toBe(5);
    expect(workbench.fsDataFt.entryAt('.hidden')?.size).toBe(7);
    expect(browser()?.rows.map((row) => [row.name, row.cells['size']])).toEqual([
      ['a', '5 B'],
      ['b', ''],
      ['c', ''],
    ]);
    http.match(() => true);
  });

  it('puts the screen right at most once a second while the details come in', async () => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1' } }));
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
    await answer(0, 0, progress({ total: 2, names: [{ name: 'a', type: 'file' }, { name: 'b', type: 'file' }], namesDone: true }));

    // A second on (the pause after an answer with little in it): the first batch is drawn.
    const many = Array.from({ length: 10_000 }, () => ({ index: 0, type: 'file' as const, size: 1, modifiedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' }));
    await answer(2, 0, progress({ total: 2, namesDone: true, details: many }));
    const shown = workbench.fsDataFt.listingState('')?.listing;

    // A full answer is followed at once — and the next one is not drawn, a second not having passed.
    await answer(2, 10_000, progress({ total: 2, namesDone: true, details: many }));
    expect(workbench.fsDataFt.listingState('')?.listing).toBe(shown);

    clock += 1000;
    await answer(2, 20_000, progress({ total: 2, namesDone: true }));
    expect(workbench.fsDataFt.listingState('')?.listing).not.toBe(shown);
    http.match(() => true);
  });
});

describe('ListingOrderFeature', () => {
  let workbench: WorkbenchService;
  let asks: ListingOrderAsk[];
  let worker: ListingOrderWorker;
  let order: ListingOrderFeature;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideOnePanel()] });
    workbench = TestBed.inject(WorkbenchService);
    asks = [];
    worker = { onmessage: null, postMessage: (message) => void asks.push(message) };
    order = TestBed.runInInjectionContext(() => new ListingOrderFeature(workbench, () => worker));
  });

  const reply = (answer: ListingOrderAnswer) => worker.onmessage?.({ data: answer } as MessageEvent<ListingOrderAnswer>);
  const named = (count: number, size = (index: number) => index): FsEntry[] =>
    Array.from({ length: count }, (_, index) => ({ ...fsEntry(`f${index}`, { size: size(index) }) }));
  const bySize = { key: 'size', direction: 'desc' } as const;

  it('sorts a small folder on the spot, as ever', () => {
    const entries = named(3);
    expect(order.sorted('x', entries, bySize, () => '').map((entry) => entry.name)).toEqual(['f2', 'f1', 'f0']);
  });

  it('shows a large folder as it comes until the worker has ordered it, then in that order', () => {
    const entries = named(WORKER_SORT_THRESHOLD);
    expect(order.sorted('x', entries, bySize, () => '')).toBe(entries);

    const reversed = Uint32Array.from({ length: entries.length }, (_, index) => entries.length - 1 - index);
    // What the effect would have asked.
    (order as unknown as { ask: (path: string, sort: typeof bySize, entries: FsEntry[]) => void }).ask('x', bySize, entries);
    expect(asks[0]?.names.split('\0')).toHaveLength(entries.length);
    expect(asks[0]?.size?.[5]).toBe(5);
    expect(asks[0]?.time).toBeNull();

    reply({ id: asks[0]?.id as number, order: reversed });
    const sorted = order.sorted('x', entries, bySize, () => '');
    expect(sorted[0]?.name).toBe(`f${entries.length - 1}`);
    expect(order.sorted('x', entries, bySize, () => '')).toBe(sorted);

    // The same entries with their details changed: the last order stands until the next answer.
    const described = entries.map((entry) => ({ ...entry }));
    expect(order.sorted('x', described, bySize, () => '')[0]).toBe(described[entries.length - 1]);
  });

  it('is ready to show a large folder only once there is an order for it', () => {
    const entries = named(WORKER_SORT_THRESHOLD);
    expect(order.ready('x', entries, bySize)).toBe(false);
    expect(order.ready('x', named(3), bySize)).toBe(true);
    (order as unknown as { ask: (path: string, sort: typeof bySize, entries: FsEntry[]) => void }).ask('x', bySize, entries);
    reply({ id: asks[0]?.id as number, order: Uint32Array.from({ length: entries.length }, (_, index) => index) });
    expect(order.ready('x', entries, bySize)).toBe(true);
    // Another sort of the same folder shows the last order until its own arrives.
    expect(order.ready('x', entries, { key: 'name', direction: 'asc' })).toBe(true);
  });

  it('lays its order over entries described since from the last result — as made afresh', () => {
    const entries = named(WORKER_SORT_THRESHOLD);
    (order as unknown as { ask: (path: string, sort: typeof bySize, entries: FsEntry[]) => void }).ask('x', bySize, entries);
    const reversed = Uint32Array.from({ length: entries.length }, (_, index) => entries.length - 1 - index);
    reply({ id: asks[0]?.id as number, order: reversed });
    const first = order.sorted('x', entries, bySize, () => '');

    const described = entries.slice();
    described[3] = { ...(entries[3] as FsEntry), size: 999 };
    described[700] = { ...(entries[700] as FsEntry), size: 7 };
    recordDelta(described, entries, [3, 700]);
    const next = order.sorted('x', described, bySize, () => '');

    expect(next).toEqual(Array.from(reversed, (index) => described[index]));
    expect(deltaOf(next)).toEqual({ from: first, changed: [entries.length - 1 - 3, entries.length - 1 - 700] });
  });

  it('keeps a by-name order through details without asking again, but not a by-size one', () => {
    const byName = { key: 'name', direction: 'asc' } as const;
    const entries = named(WORKER_SORT_THRESHOLD);
    const internals = order as unknown as { asked: Map<string, readonly FsEntry[]>; carries: (key: string, sort: unknown, entries: readonly FsEntry[]) => boolean };
    internals.asked.set('name:asc:x', entries);
    internals.asked.set('size:desc:x', entries);
    const described = entries.slice();
    described[5] = { ...(entries[5] as FsEntry), size: 1 };
    recordDelta(described, entries, [5]);

    expect(internals.carries('name:asc:x', byName, described)).toBe(true);
    expect(internals.carries('size:desc:x', bySize, described)).toBe(false);
    // A link found to lead to a folder moves among the folders: asked again.
    described[5] = { ...(entries[5] as FsEntry), type: 'directory' };
    expect(internals.carries('name:asc:x', byName, described)).toBe(false);
  });

  it('asks the worker about what a panel shows, once per change', async () => {
    const entries = named(WORKER_SORT_THRESHOLD);
    vi.spyOn(workbench.fsDataFt, 'entries').mockReturnValue(entries);
    TestBed.tick();
    const panel = asks.filter((ask) => ask.folder.length === entries.length);
    expect(panel).toHaveLength(1);
    TestBed.tick();
    expect(asks.filter((ask) => ask.folder.length === entries.length)).toHaveLength(1);
  });
});
