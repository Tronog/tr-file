import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { DEFAULT_WINDOW_STATE, fitToScreens, WindowStateFile, type WindowRect } from './window-state.js';

/** PRD 001, §8.2.1 — the window comes back as it was left: size, place, maximised or full screen. */

let folder: string;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tr-file-window-'));
});

after(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('WindowStateFile', () => {
  it('starts from the default with no file, or a broken one', async () => {
    assert.deepEqual(new WindowStateFile(join(folder, 'none.json')).read(), DEFAULT_WINDOW_STATE);
    await writeFile(join(folder, 'broken.json'), '{ not json');
    assert.deepEqual(new WindowStateFile(join(folder, 'broken.json')).read(), DEFAULT_WINDOW_STATE);
  });

  it('keeps the state a moment after it changes, and at once when flushed', async () => {
    const file = join(folder, 'state.json');
    const states = new WindowStateFile(file);
    states.keep({ x: 10, y: 20, width: 1000, height: 700, maximized: false, fullScreen: false });
    states.keep({ x: 30, y: 40, width: 1100, height: 800, maximized: true, fullScreen: false });
    await assert.rejects(readFile(file, 'utf8'));

    states.flush();
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { x: 30, y: 40, width: 1100, height: 800, maximized: true, fullScreen: false });
    assert.deepEqual(new WindowStateFile(file).read(), { x: 30, y: 40, width: 1100, height: 800, maximized: true, fullScreen: false });
  });

  it('keeps only what holds together', () => {
    assert.deepEqual(WindowStateFile.parse({ x: 'far', y: 5, width: 100, height: 99_999.4, maximized: 'yes', fullScreen: true }), {
      width: DEFAULT_WINDOW_STATE.width,
      height: 99_999,
      maximized: false,
      fullScreen: true,
    });
    assert.deepEqual(WindowStateFile.parse([]), { ...DEFAULT_WINDOW_STATE, width: DEFAULT_WINDOW_STATE.width });
  });
});

describe('fitToScreens', () => {
  const laptop: WindowRect = { x: 0, y: 0, width: 1920, height: 1040 };
  const monitor: WindowRect = { x: 1920, y: 0, width: 2560, height: 1400 };

  it('keeps a place on a screen that is there', () => {
    const state = { x: 2100, y: 100, width: 1600, height: 1000, maximized: true, fullScreen: false };
    assert.deepEqual(fitToScreens(state, [laptop, monitor]), state);
  });

  it('lets the OS centre a window whose screen has gone, and fits it to the one left', () => {
    const state = { x: 2100, y: 100, width: 2400, height: 1300, maximized: false, fullScreen: false };
    assert.deepEqual(fitToScreens(state, [laptop]), { width: 1920, height: 1040, maximized: false, fullScreen: false });
  });

  it('will not keep a window whose title bar is off every screen', () => {
    assert.equal(fitToScreens({ x: 100, y: -500, width: 1000, height: 700, maximized: false, fullScreen: false }, [laptop]).x, undefined);
    assert.equal(fitToScreens({ x: 1900, y: 100, width: 1000, height: 700, maximized: false, fullScreen: false }, [laptop]).x, undefined);
    assert.equal(fitToScreens({ x: -950, y: 100, width: 1000, height: 700, maximized: false, fullScreen: false }, [laptop]).x, undefined);
    // A hundred pixels of it are enough to grab it by.
    assert.equal(fitToScreens({ x: -900, y: 100, width: 1000, height: 700, maximized: false, fullScreen: false }, [laptop]).x, -900);
  });

  it('leaves the state alone when no screen is known', () => {
    const state = { x: 5000, y: 5000, width: 1000, height: 700, maximized: false, fullScreen: false };
    assert.deepEqual(fitToScreens(state, []), state);
  });
});
