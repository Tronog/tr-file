import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bringForward, FOCUS_SETTLE_MS, toggleVisibility, VISIBILITY_ACCELERATOR, VisibilityShortcut, type ToggleableWindow } from './window-visibility.js';

/** PRD 001, §8.5 — `Ctrl`+`` ` `` shows and hides the window, from anywhere. */

interface WindowState {
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  destroyed?: boolean;
}

/**
 * A window whose manager grants focus as told: `grants` says, for each request
 * in turn, whether it is granted — a refused one leaves the window unfocused.
 */
function window(state: WindowState, grants: boolean[] = []): ToggleableWindow & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isVisible: () => state.visible,
    isFocused: () => state.focused,
    isMinimized: () => state.minimized,
    isDestroyed: () => state.destroyed ?? false,
    show: () => void (calls.push('show'), (state.visible = true)),
    hide: () => void (calls.push('hide'), (state.visible = false), (state.focused = false)),
    restore: () => void (calls.push('restore'), (state.minimized = false)),
    focus: () => void (calls.push('focus'), (state.focused = grants.length === 0 ? true : (grants.shift() ?? false))),
    setAlwaysOnTop: (flag) => void calls.push(flag ? 'top' : 'untop'),
  };
}

const waits: number[] = [];
const settle = async (ms: number): Promise<void> => void waits.push(ms);

describe('toggleVisibility', () => {
  it('hides the window the user is looking at', async () => {
    const shown = window({ visible: true, focused: true, minimized: false });
    assert.equal(await toggleVisibility(shown, 'linux', settle), 'hidden');
    assert.deepEqual(shown.calls, ['hide']);
  });

  it('brings back a hidden window, with the keyboard', async () => {
    const hidden = window({ visible: false, focused: false, minimized: false });
    assert.equal(await toggleVisibility(hidden, 'linux', settle), 'focused');
    assert.deepEqual(hidden.calls, ['show', 'focus']);
  });

  it('brings to the front a window behind another app’s, rather than hiding it', async () => {
    const behind = window({ visible: true, focused: false, minimized: false });
    assert.equal(await toggleVisibility(behind, 'linux', settle), 'focused');
    assert.deepEqual(behind.calls, ['show', 'focus']);
  });

  it('restores a minimised window', async () => {
    const minimized = window({ visible: true, focused: true, minimized: true });
    assert.equal(await toggleVisibility(minimized, 'linux', settle), 'focused');
    assert.deepEqual(minimized.calls, ['restore', 'show', 'focus']);
  });
});

/** PRD 001, §8.5.1 — a window already open comes forward and takes the keyboard. */
describe('bringForward', () => {
  it('shows it afresh where the window manager turns the focus request down (GNOME on Wayland)', async () => {
    waits.length = 0;
    const refused = window({ visible: true, focused: false, minimized: false }, [false, true]);
    assert.equal(await bringForward(refused, 'linux', settle), 'remapped');
    assert.deepEqual(refused.calls, ['show', 'focus', 'hide', 'show', 'focus']);
    assert.deepEqual(waits, [FOCUS_SETTLE_MS, FOCUS_SETTLE_MS]);
  });

  it('leaves alone a window focused at the first ask', async () => {
    const granted = window({ visible: true, focused: false, minimized: false }, [true]);
    assert.equal(await bringForward(granted, 'linux', settle), 'focused');
    assert.deepEqual(granted.calls, ['show', 'focus']);
  });

  it('says so when even a window shown afresh is not given the focus', async () => {
    const stubborn = window({ visible: true, focused: false, minimized: false }, [false, false]);
    assert.equal(await bringForward(stubborn, 'linux', settle), 'refused');
  });

  it('does not show again a window hidden or closed meanwhile', async () => {
    const state: WindowState = { visible: true, focused: false, minimized: false };
    const hiddenAgain = window(state, [false]);
    const pending = bringForward(hiddenAgain, 'linux', async () => void (state.visible = false));
    assert.equal(await pending, 'focused');
    assert.deepEqual(hiddenAgain.calls, ['show', 'focus']);

    const closedState: WindowState = { visible: true, focused: false, minimized: false };
    const closed = window(closedState, [false]);
    assert.equal(await bringForward(closed, 'linux', async () => void (closedState.destroyed = true)), 'focused');
    assert.deepEqual(closed.calls, ['show', 'focus']);
  });

  it('on Windows, raises it topmost for a moment so the focus is not just a flashing taskbar button', async () => {
    waits.length = 0;
    const behind = window({ visible: true, focused: false, minimized: true });
    assert.equal(await bringForward(behind, 'win32', settle), 'focused');
    assert.deepEqual(behind.calls, ['restore', 'show', 'top', 'focus', 'untop']);
    assert.deepEqual(waits, []);
  });

  it('on macOS, only asks (the app is made frontmost by the caller)', async () => {
    const behind = window({ visible: true, focused: false, minimized: false });
    assert.equal(await bringForward(behind, 'darwin', settle), 'focused');
    assert.deepEqual(behind.calls, ['show', 'focus']);
  });
});

describe('VisibilityShortcut', () => {
  it('registers Ctrl+` system-wide, once, and gives it back', () => {
    const registered: string[] = [];
    const unregistered: string[] = [];
    let pressed = 0;
    const shortcut = new VisibilityShortcut(
      { register: (accelerator, callback) => (registered.push(accelerator), callback(), true), unregister: (accelerator) => void unregistered.push(accelerator) },
      () => (pressed += 1),
      () => assert.fail('nothing to warn about'),
    );

    assert.equal(shortcut.register(), true);
    assert.equal(shortcut.register(), true);
    shortcut.dispose();
    shortcut.dispose();

    assert.equal(VISIBILITY_ACCELERATOR, 'Control+`');
    assert.deepEqual(registered, ['Control+`']);
    assert.deepEqual(unregistered, ['Control+`']);
    assert.equal(pressed, 1);
  });

  it('runs without it, and says why, when the chord is taken or the session offers none', () => {
    const warnings: string[] = [];
    const taken = new VisibilityShortcut({ register: () => false, unregister: () => assert.fail('never registered') }, () => undefined, (message) => void warnings.push(message));
    const refused = new VisibilityShortcut(
      { register: () => { throw new Error('no portal'); }, unregister: () => assert.fail('never registered') },
      () => undefined,
      (message) => void warnings.push(message),
    );

    assert.equal(taken.register(), false);
    assert.equal(refused.register(), false);
    taken.dispose();
    refused.dispose();

    assert.deepEqual(warnings, ['global shortcut is taken by another application', 'global shortcut could not be registered']);
  });
});
