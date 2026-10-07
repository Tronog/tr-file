import { adapterLabel, place, formatBits, formatBytesRate, formatUptime, niceTop } from './performance';

/** PRD 014, §2.1 — how the Graph section scales and words what it draws. */
describe('performance', () => {
  it('rounds a transfer graph’s top up to 1, 2 or 5 of a power of ten, never under its floor', () => {
    expect([niceTop(0, 100), niceTop(101, 100), niceTop(250, 100), niceTop(5000, 100), niceTop(5001, 100)]).toEqual([100, 200, 500, 5000, 10_000]);
  });

  it('places samples by when they were taken — 2 s apart while watched, 10 s while not — the newest at the right (§4.1)', () => {
    // Idle at 10 s, then watched at 2 s; a series shorter than the times matches their end.
    const times = [0, 10_000, 20_000, 22_000, 24_000];
    // Twenty seconds back from the newest: 10 s, 20 s, 22 s and 24 s are in, at 30 %, 80 %, 90 % and the right edge.
    expect(place(times, [1, 2, 3, 4, 5], 20_000)).toEqual({ values: [2, 3, 4, 5], x: [0.3, 0.8, 0.9, 1] });
    expect(place(times, [4, 5], 60_000).x).toEqual([58_000 / 60_000, 1]);
    // The backend down for a minute: the line breaks there.
    expect(place([0, 2000, 62_000], [1, 1, 1], 60_000)).toEqual({ values: [1, null, 1], x: [0, 1, 1] });
    expect(place([], [], 60_000)).toEqual({ values: [], x: [] });
  });

  it('words speeds and up time as Task Manager does', () => {
    expect([formatBytesRate(0), formatBytesRate(512 * 1024), formatBytesRate(12.34 * 1024 ** 2)]).toEqual(['0 KB/s', '512 KB/s', '12.3 MB/s']);
    expect([formatBits(0), formatBits(120_000), formatBits(8_400_000), formatBits(1_200_000_000)]).toEqual(['0 Kbps', '120 Kbps', '8.4 Mbps', '1.2 Gbps']);
    expect(formatUptime(3 * 86_400 + 4 * 3600 + 5 * 60 + 9)).toBe('3:04:05:09');
  });

  it('names an adapter as Task Manager does', () => {
    expect([adapterLabel('wlp2s0', 'linux'), adapterLabel('enp3s0', 'linux'), adapterLabel('docker0', 'linux'), adapterLabel('Wi-Fi 2', 'win32')]).toEqual([
      'Wi-Fi',
      'Ethernet',
      'docker0',
      'Wi-Fi 2',
    ]);
  });
});
