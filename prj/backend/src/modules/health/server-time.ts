/**
 * The backend machine's clock (PRD 001, §13.1): now, and the time zone it
 * keeps — which is what the status bar shows, not the browser's. Answered by
 * `GET /api/health` and by the bridge's `time` command alike.
 */
export interface ServerTimeDto {
  /** Now, as an ISO 8601 instant. */
  readonly now: string;
  /** The IANA zone the machine is set to (`Europe/Zagreb`), or `UTC` when it names none. */
  readonly timeZone: string;
  /** Its offset from UTC now, in minutes east — `120` in Zagreb in summer. */
  readonly utcOffsetMinutes: number;
}

export function serverTime(now: Date = new Date()): ServerTimeDto {
  return {
    now: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    // `getTimezoneOffset` is minutes *west*, and `-0` is not worth sending.
    utcOffsetMinutes: -now.getTimezoneOffset() || 0,
  };
}
