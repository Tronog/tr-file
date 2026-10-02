import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clampZoom, MAX_ZOOM, MIN_ZOOM, stepZoom } from './window-zoom.js';

/** PRD 001, §8.2.3 — the window's zoom: browser-like levels in and out, any whole percent between the ends. */
describe('window zoom', () => {
  it('keeps a factor within the ends, to a whole percent', () => {
    assert.equal(clampZoom(1.234), 1.23);
    assert.equal(clampZoom(0.1), MIN_ZOOM);
    assert.equal(clampZoom(10), MAX_ZOOM);
    assert.equal(clampZoom('2'), 1);
    assert.equal(clampZoom(Number.NaN), 1);
  });

  it('steps through the levels, from between two to the nearer one that way, and stops at the ends', () => {
    assert.equal(stepZoom(1, 1), 1.1);
    assert.equal(stepZoom(1, -1), 0.9);
    assert.equal(stepZoom(1.1, -1), 1);
    assert.equal(stepZoom(1.3, 1), 1.5);
    assert.equal(stepZoom(1.3, -1), 1.25);
    assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
    assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM);
  });
});
