import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toggleVisibility, VISIBILITY_ACCELERATOR, VisibilityShortcut, type ToggleableWindow } from './window-visibility.js';

/** PRD 001, §8.5 — `Ctrl`+`` ` `` shows and hides the window, from anywhere. */

function window(state: { visible: boolean; focused: boolean; minimized: boolean }): ToggleableWindow & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isVisible: () => state.visible,
    isFocused: () => state.focused,
    isMinimized: () => state.minimized,
    show: () => void calls.push('show'),
    hide: () => void calls.push('hide'),
    restore: () => void calls.push('restore'),
    focus: () => void calls.push('focus'),
  };
}

describe('toggleVisibility', () => {
  it('hides the window the user is looking at', () => {
    const shown = window({ visible: true, focused: true, minimized: false });
    assert.equal(toggleVisibility(shown), 'hidden');
    assert.deepEqual(shown.calls, ['hide']);
  });

  it('brings back a hidden window, with the keyboard', () => {
    const hidden = window({ visible: false, focused: false, minimized: false });
    assert.equal(toggleVisibility(hidden), 'shown');
    assert.deepEqual(hidden.calls, ['show', 'focus']);
  });

  it('brings to the front a window behind another app’s, rather than hiding it', () => {
    const behind = window({ visible: true, focused: false, minimized: false });
    assert.equal(toggleVisibility(behind), 'shown');
    assert.deepEqual(behind.calls, ['show', 'focus']);
  });

  it('restores a minimised window', () => {
    const minimized = window({ visible: true, focused: true, minimized: true });
    assert.equal(toggleVisibility(minimized), 'shown');
    assert.deepEqual(minimized.calls, ['restore', 'show', 'focus']);
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
