import { DestroyRef, computed, inject, signal } from '@angular/core';
import type { FsServerTime } from '../../file-system/file-system.model';
import type { WorkbenchService } from '../workbench.service';

/** How often the server is asked again, so the clock does not drift from it. */
export const CLOCK_SYNC_MS = 10 * 60 * 1000;

/** After a failed ask, how long before the next. */
export const CLOCK_RETRY_MS = 60 * 1000;

/** What is known of the server's clock. */
interface ServerClock {
  /** The server's time minus this computer's, in milliseconds. */
  readonly skew: number;
  /** Its IANA zone, when it named one this browser knows. */
  readonly timeZone: string | null;
  /** Its offset from UTC in minutes, when it said. */
  readonly utcOffsetMinutes: number | null;
}

/**
 * The backend machine's date and time, at the right of the status bar
 * (PRD 001, §13.1) — the server's, not this computer's: connected to a server
 * elsewhere, it is that server's time, in its time zone.
 *
 * The server is asked now and then (`CLOCK_SYNC_MS`), not every second: the
 * answer is kept as the difference from this computer's clock — halfway
 * through the request, so the round trip does not count — and the clock
 * ticks here, once a minute, on the server's minute. A server that never
 * answers shows nothing, rather than a time that is not its own.
 */
export class ServerClockFeature {
  private readonly clock = signal<ServerClock | null>(null);

  /** This computer's time at the last tick. */
  private readonly now = signal(Date.now());

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly parent: WorkbenchService) {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts asking and ticking; the workbench component calls it, so a service built for a test asks nothing. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.sync();
  }

  stop(): void {
    this.running = false;
    for (const timer of [this.tickTimer, this.syncTimer]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    this.tickTimer = null;
    this.syncTimer = null;
  }

  /** Asks the server for its time. Public so a test can drive it. */
  async sync(): Promise<void> {
    const asked = Date.now();
    let delay = CLOCK_SYNC_MS;
    try {
      const time = await this.parent.fileSystem.readFt.serverTime();
      this.clock.set(ServerClockFeature.read(time, (asked + Date.now()) / 2));
      this.tick();
    } catch {
      delay = CLOCK_RETRY_MS;
    }
    if (this.running) {
      this.syncTimer = setTimeout(() => void this.sync(), delay);
    }
  }

  /** The status bar's words: `Sun 27 Sep 14:32`; `null` until the server has said. */
  readonly label = computed<string | null>(() => {
    const at = this.serverNow();
    return at === null ? null : this.format(at, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  });

  /** The tooltip: the whole date, and which zone it is in. */
  readonly title = computed<string | null>(() => {
    const at = this.serverNow();
    const clock = this.clock();
    if (at === null || clock === null) {
      return null;
    }
    const when = this.format(at, { dateStyle: 'full', timeStyle: 'short' });
    const offset = clock.utcOffsetMinutes === null ? null : ServerClockFeature.offsetLabel(clock.utcOffsetMinutes);
    const zone =
      clock.timeZone !== null && offset !== null
        ? `${clock.timeZone} (${offset})`
        : (clock.timeZone ?? offset ?? 'in this computer’s time zone');
    return `Server time: ${when} — ${zone}`;
  });

  /** The server's time now, in ms since the epoch. */
  private readonly serverNow = computed<number | null>(() => {
    const clock = this.clock();
    return clock === null ? null : this.now() + clock.skew;
  });

  /** Moves the clock on, then waits for the server's next minute. */
  private tick(): void {
    this.now.set(Date.now());
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    const at = this.serverNow();
    if (!this.running || at === null) {
      return;
    }
    this.tickTimer = setTimeout(() => this.tick(), 60_000 - (at % 60_000) + 50);
  }

  /**
   * A time as the server's clock reads it: in its zone when this browser
   * knows that zone; else at its offset from UTC; else — a server that never
   * said — in this computer's.
   */
  private format(at: number, options: Intl.DateTimeFormatOptions): string {
    const clock = this.clock();
    if (clock?.timeZone != null) {
      return new Intl.DateTimeFormat(undefined, { ...options, timeZone: clock.timeZone }).format(at);
    }
    if (clock?.utcOffsetMinutes != null) {
      return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(at + clock.utcOffsetMinutes * 60_000);
    }
    return new Intl.DateTimeFormat(undefined, options).format(at);
  }

  /** What is kept of an answer: the skew from `midpoint`, and a zone this browser can use. */
  private static read(time: FsServerTime, midpoint: number): ServerClock {
    const server = Date.parse(time.now);
    return {
      skew: Number.isNaN(server) ? 0 : server - midpoint,
      timeZone: time.timeZone !== undefined && ServerClockFeature.knows(time.timeZone) ? time.timeZone : null,
      utcOffsetMinutes: typeof time.utcOffsetMinutes === 'number' ? time.utcOffsetMinutes : null,
    };
  }

  private static knows(timeZone: string): boolean {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone });
      return true;
    } catch {
      return false;
    }
  }

  /** `UTC+02:00`, `UTC−05:30`, `UTC`. */
  private static offsetLabel(minutes: number): string {
    if (minutes === 0) {
      return 'UTC';
    }
    const sign = minutes > 0 ? '+' : '−';
    const absolute = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  }
}
