import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HealthService } from './health.service.js';
import { serverTime } from './server-time.js';

/** PRD 001, §13.1 — the health check says what time it is on this machine, and where. */
describe('health', () => {
  it("reports the machine's time zone and its offset beside the time", () => {
    const status = new HealthService('1.0.0', 'test').check().toJSON();

    assert.equal(status.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(status.utcOffsetMinutes, -new Date(status.timestamp).getTimezoneOffset() || 0);
  });

  it('writes the offset in minutes east of UTC, for the instant asked about', () => {
    const at = new Date('2026-01-15T12:00:00Z');
    const time = serverTime(at);

    assert.equal(time.now, '2026-01-15T12:00:00.000Z');
    assert.equal(time.utcOffsetMinutes, -at.getTimezoneOffset() || 0);
  });
});
