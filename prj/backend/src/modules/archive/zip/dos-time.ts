/**
 * MS-DOS date and time, the only timestamp every ZIP reader understands.
 * They are *local* time with two-second resolution and a 1980–2107 range —
 * which is why the writer also stores an extended timestamp in UTC, and why a
 * date outside the range is clamped rather than wrapped into nonsense.
 */
export interface DosDateTime {
  readonly date: number;
  readonly time: number;
}

const DOS_MIN_YEAR = 1980;
const DOS_MAX_YEAR = 2107;

export function toDosDateTime(value: Date): DosDateTime {
  const year = value.getFullYear();
  if (Number.isNaN(year) || year < DOS_MIN_YEAR) {
    return { date: (1 << 5) | 1, time: 0 };
  }
  if (year > DOS_MAX_YEAR) {
    return {
      date: ((DOS_MAX_YEAR - DOS_MIN_YEAR) << 9) | (12 << 5) | 31,
      time: (23 << 11) | (59 << 5) | 29,
    };
  }
  return {
    date: ((year - DOS_MIN_YEAR) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | (value.getSeconds() >> 1),
  };
}

/** The local-time `Date` a DOS date and time stand for. Out-of-range fields are left to `Date` to roll over. */
export function fromDosDateTime(date: number, time: number): Date {
  return new Date(
    ((date >> 9) & 0x7f) + DOS_MIN_YEAR,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}
