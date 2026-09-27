import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkbenchService } from '../workbench.service';
import { CLOCK_RETRY_MS, CLOCK_SYNC_MS } from './server-clock.feature';

/** PRD 001, §13.1 — the backend machine's date and time, at the right of the status bar. */
describe('ServerClockFeature', () => {
  let workbench: WorkbenchService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // This computer: 10:00:30 UTC.
    vi.setSystemTime(new Date('2026-09-27T10:00:30Z'));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
  });

  afterEach(() => {
    workbench.serverClockFt.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const clock = () => workbench.serverClockFt;
  const answer = (time: { now: string; timeZone?: string; utcOffsetMinutes?: number }) =>
    vi.spyOn(workbench.fileSystem.readFt, 'serverTime').mockResolvedValue(time);
  const statusClock = () => workbench.chromeFt.statusTrailingItems().find((item) => item.id === 'clock');

  it('shows nothing until the server has said what time it is', () => {
    expect(clock().label()).toBeNull();
    expect(statusClock()).toBeUndefined();
  });

  it("shows the server's time in the server's zone — not this computer's — last in the status bar", async () => {
    // The server is five minutes ahead, in Tokyo.
    answer({ now: '2026-09-27T10:05:30Z', timeZone: 'Asia/Tokyo', utcOffsetMinutes: 540 });

    await clock().sync();

    const shown = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(
      Date.parse('2026-09-27T10:05:30Z'),
    );
    expect(clock().label()).toBe(shown);
    expect(clock().title()).toMatch(/^Server time: .* — Asia\/Tokyo \(UTC\+09:00\)$/);
    const items = workbench.chromeFt.statusTrailingItems();
    expect(items.at(-1)).toMatchObject({ id: 'clock', label: shown, icon: 'clock' });
  });

  it('keeps time between asks, moving on at each of the server’s minutes', async () => {
    answer({ now: '2026-09-27T10:05:30Z', timeZone: 'UTC', utcOffsetMinutes: 0 });
    clock().start();
    await vi.advanceTimersByTimeAsync(0);
    const first = clock().label();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(clock().label()).toBe(first);

    await vi.advanceTimersByTimeAsync(1_100);
    expect(clock().label()).not.toBe(first);
    expect(clock().label()).toContain('10:06');
  });

  it('asks again now and then, and sooner after a failure', async () => {
    const ask = vi
      .spyOn(workbench.fileSystem.readFt, 'serverTime')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ now: '2026-09-27T10:00:30Z', timeZone: 'UTC', utcOffsetMinutes: 0 });
    clock().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(clock().label()).toBeNull();

    await vi.advanceTimersByTimeAsync(CLOCK_RETRY_MS);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(clock().label()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(CLOCK_SYNC_MS);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('falls back to the offset for a zone this browser does not know, and to this computer’s zone for a server that named none', async () => {
    answer({ now: '2026-09-27T10:05:30Z', timeZone: 'Nowhere/Atlantis', utcOffsetMinutes: -330 });
    await clock().sync();
    expect(clock().title()).toMatch(/— UTC−05:30$/);

    answer({ now: '2026-09-27T10:05:30Z' });
    await clock().sync();
    expect(clock().title()).toMatch(/— in this computer’s time zone$/);
  });

  it('reads it from the health check over HTTP', async () => {
    const http = TestBed.inject(HttpTestingController);
    const time = workbench.fileSystem.readFt.serverTime();

    http.expectOne('/api/health').flush({ data: { status: 'ok', timestamp: '2026-09-27T10:05:30.000Z', timeZone: 'Europe/Zagreb', utcOffsetMinutes: 120 } });

    expect(await time).toEqual({ now: '2026-09-27T10:05:30.000Z', timeZone: 'Europe/Zagreb', utcOffsetMinutes: 120 });
  });
});
