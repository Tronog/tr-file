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

  it('is named, shown without details, then described — the panel following each stage', async () => {
    workbench.start();
    // The names read on the way to finding it large come with the answer, and are on screen at once.
    http.expectOne(listUrl('')).flush(
      fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1', names: [{ name: 'b.txt', type: 'file' }] } }),
    );
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
    await settled();
    expect(browser()?.rows.map((row) => row.name)).toEqual(['b.txt']);
    expect(browser()?.summary).toBe('1 item · reading…');

    // The rest come as they are read, asked for from after the first; how many is known with the last.
    await answer(1, 0, progress({ names: [{ name: 'a.txt', type: 'file' }] }));
    clock += 1000;
    await answer(2, 0, progress({ total: 3, names: [{ name: 'docs', type: 'directory' }], namesDone: true }));
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
    expect(browser()?.summary).toBe('2 items · refresh by hand');
    expect(workbench.fsDataFt.listingState('')?.status).toBe('ready');
    expect(workbench.editorGroupsFt.group(workbench.activeGroupId())?.loading).toBeUndefined();
    http.match(() => true);
  });

  /** §3.1.1 — never polled for changes: read again only by Refresh. */
  it('is left out of auto-refresh, and read again by Refresh', async () => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1' } }));
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
    await settled();
    // Large from the token on, before anything is counted.
    expect(workbench.autoRefreshFt.foldersShown()).toEqual([]);
    await answer(0, 0, progress({ total: 1, names: [{ name: 'a', type: 'file' }], namesDone: true, done: true }));
    expect(workbench.fsDataFt.isLarge('')).toBe(true);
    expect(workbench.autoRefreshFt.foldersShown()).toEqual([]);

    workbench.fileBrowserFt.runToolbarAction(workbench.activeGroupId(), 'refresh');
    await settled();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1' } }));
    await answer(0, 0, progress({ total: 1, names: [{ name: 'b', type: 'file' }], namesDone: true, done: true }));
    expect(browser()?.rows.map((row) => row.name)).toEqual(['b']);

    // Grown small again: an ordinary listing, watched as ever.
    workbench.fileBrowserFt.runToolbarAction(workbench.activeGroupId(), 'refresh');
    await settled();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [fsEntry('c')] }));
    await settled();
    expect(workbench.fsDataFt.isLarge('')).toBe(false);
    expect(workbench.autoRefreshFt.foldersShown()).toEqual(['']);
    http.match(() => true);
  });

  /**
   * §3.1.2 — a large folder left before it is all in stops being read. A
   * subfolder, `big`: the root is always on screen, in the Explorer's tree.
   */
  describe('left while it is being read', () => {
    const progressive = () => fsEnvelope({ path: 'big', parent: '', entries: [], progressive: { token: 't1' } });
    const cancels = () => http.match((request) => request.method === 'DELETE' && request.url.startsWith('/api/fs/list-progress'));
    const polls = () => http.match((request) => request.method === 'GET' && request.url.startsWith('/api/fs/list-progress'));
    const group = () => workbench.activeGroupId();

    /** Opens `folder` in the panel, answering a small listing for anything but `big`. */
    async function open(folder: string): Promise<void> {
      workbench.fileBrowserFt.navigateTo(group(), folder, folder);
      TestBed.tick();
      await settled();
      if (folder !== 'big') {
        http.match(listUrl(folder)).forEach((request) => request.flush(fsEnvelope({ path: folder, parent: folder === '' ? null : '', entries: [] })));
        await settled();
      }
    }

    beforeEach(async () => {
      workbench.start();
      http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [] }));
      http.match(() => true).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
      await settled();
      TestBed.tick();
    });

    async function openBigAndAnswerOnce(): Promise<void> {
      await open('big');
      http.expectOne(listUrl('big')).flush(progressive());
      await answer(0, 0, progress({ path: 'big', total: 5, names: [{ name: 'a', type: 'file' }] }));
      TestBed.tick();
    }

    it('asks no more, tells the backend, and keeps nothing half read', async () => {
      await openBigAndAnswerOnce();
      await open('elsewhere');

      const cancel = cancels();
      expect(cancel).toHaveLength(1);
      expect(cancel[0]?.request.urlWithParams).toContain('token=t1');
      cancel[0]?.flush(fsEnvelope({ cancelled: true }));
      // The question already on its way fails — the backend forgot the token — and that is no error.
      polls().forEach((request) => request.flush({ error: { code: 'NOT_FOUND', message: 'gone' } }, { status: 404, statusText: 'Not Found' }));
      clock += 5000;
      await settled();
      expect(polls()).toEqual([]);
      expect(workbench.fsDataFt.listingState('big')).toBeUndefined();
      expect(workbench.fsDataFt.isReadingLarge('big')).toBe(false);

      // Opened again: read afresh.
      await open('big');
      expect(http.match(listUrl('big'))).toHaveLength(1);
      http.match(() => true);
    });

    it('goes on while another panel still shows it', async () => {
      await openBigAndAnswerOnce();
      workbench.editorGroupsFt.runAction(group(), 'split-right');
      TestBed.tick();
      await open('elsewhere');

      expect(cancels()).toEqual([]);
      expect(workbench.fsDataFt.isReadingLarge('big')).toBe(true);
      http.match(() => true);
    });

    it('gives up a refresh left half way for the listing it had', async () => {
      await open('big');
      http.expectOne(listUrl('big')).flush(progressive());
      await answer(0, 0, progress({ path: 'big', total: 1, names: [{ name: 'old', type: 'file' }], namesDone: true, done: true }));

      workbench.fileBrowserFt.runToolbarAction(group(), 'refresh');
      await settled();
      http.expectOne(listUrl('big')).flush(progressive());
      await answer(0, 0, progress({ path: 'big', total: 1 }));
      TestBed.tick();

      await open('elsewhere');
      cancels();
      await settled();
      expect(workbench.fsDataFt.listingState('big')).toMatchObject({ status: 'ready', large: true });
      expect(workbench.fsDataFt.entries('big').map((entry) => entry.name)).toEqual(['old']);
      http.match(() => true);
    });

    it('gives up a folder left before its first answer, once that says it is large', async () => {
      await open('big');
      const first = http.expectOne(listUrl('big'));
      await open('elsewhere');
      first.flush(progressive());
      await settled();
      await settled();

      expect(cancels()).toHaveLength(1);
      expect(polls()).toEqual([]);
      http.match(() => true);
    });

    it('keeps reading a folder left and come back to before its first answer', async () => {
      await open('big');
      const first = http.expectOne(listUrl('big'));
      await open('elsewhere');
      workbench.panelHistoryFt.back(group());
      TestBed.tick();
      await settled();
      first.flush(progressive());
      await settled();

      expect(cancels()).toEqual([]);
      expect(workbench.fsDataFt.isReadingLarge('big')).toBe(true);
      http.match(() => true);
    });
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

  it('says it is reading until the first names come, and shows them as they do', async () => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1' } }));
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
    await answer(0, 0, progress({}));
    expect(browser()?.empty?.title).toBe('Reading the entries of this folder…');

    clock += 1000;
    await answer(0, 0, progress({ names: [{ name: 'b.txt', type: 'file' }] }));
    expect(browser()?.empty).toBeUndefined();
    expect(browser()?.rows.map((row) => row.name)).toEqual(['b.txt']);
    http.match(() => true);
  });

  it('extends what it made as names are added — the same as made afresh', async () => {
    workbench.showHidden.set(false);
    workbench.start();
    const names = (list: string[]) => list.map((name) => ({ name, type: 'file' as const }));
    http.expectOne(listUrl('')).flush(fsEnvelope({ path: '', parent: null, entries: [], progressive: { token: 't1', names: names(['c', '.h1']) } }));
    http.match(detailsUrl('')).forEach((request) => request.flush(fsEnvelope(fsDetails(''))));
    await settled();
    const shownBefore = workbench.fsDataFt.entries('');
    expect(shownBefore.map((entry) => entry.name)).toEqual(['c']);

    clock += 1000;
    await answer(2, 0, progress({ names: names(['.h2', 'a', 'b']) }));
    const all = workbench.fsDataFt.listingState('')?.listing?.entries as readonly FsEntry[];
    const shown = workbench.fsDataFt.entries('');
    expect(shown).toEqual(all.filter((entry) => !entry.hidden));
    expect(deltaOf(shown)?.from).toBe(shownBefore);
    expect(workbench.fsDataFt.entryAt('b')?.name).toBe('b');
    expect(browser()?.rows.map((row) => row.name)).toEqual(['a', 'b', 'c']);
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
    recordDelta(described, entries, entries.map((_, index) => index));
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

  it('lays an order over a longer listing made from the one it was worked out for, the rest after it', () => {
    const internals = order as unknown as { ask: (path: string, sort: typeof bySize, entries: readonly FsEntry[]) => void };
    const first = named(WORKER_SORT_THRESHOLD);
    internals.ask('x', bySize, first);
    reply({ id: asks[0]?.id as number, order: Uint32Array.from({ length: first.length }, (_, index) => first.length - 1 - index) });

    const longer = [...first, ...named(WORKER_SORT_THRESHOLD + 2).slice(WORKER_SORT_THRESHOLD)];
    recordDelta(longer, first, []);
    expect(order.ready('x', longer, bySize)).toBe(true);
    const sorted = order.sorted('x', longer, bySize, () => '');
    expect(sorted[0]).toBe(first[first.length - 1]);
    expect(sorted.slice(-2)).toEqual(longer.slice(-2));
    // Not one made some other way.
    expect(order.ready('x', longer.slice(), bySize)).toBe(false);
  });

  it('keeps a later order over an earlier one answered late, and asks one question at a time', () => {
    const internals = order as unknown as { ask: (path: string, sort: typeof bySize, entries: readonly FsEntry[]) => void };
    const first = named(WORKER_SORT_THRESHOLD);
    const later = [...first, ...named(WORKER_SORT_THRESHOLD + 1).slice(WORKER_SORT_THRESHOLD)];
    recordDelta(later, first, []);
    internals.ask('x', bySize, first);
    internals.ask('x', bySize, later);
    const identity = (count: number) => Uint32Array.from({ length: count }, (_, index) => index);

    reply({ id: asks[1]?.id as number, order: identity(later.length) });
    reply({ id: asks[0]?.id as number, order: Uint32Array.from({ length: first.length }, (_, index) => first.length - 1 - index) });
    // The late answer, for fewer entries, did not replace the later one.
    expect(order.sorted('x', later, bySize, () => '')[0]).toBe(later[0]);
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
