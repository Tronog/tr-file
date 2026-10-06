import { TestBed } from '@angular/core/testing';
import { chordOf, displayChord, isChord, UiKeymap } from './keymap';

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

describe('chordOf', () => {
  it('writes modifiers in order, letters in capitals and symbols as typed', () => {
    expect(chordOf(key({ key: 'p', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P');
    expect(chordOf(key({ key: '*', shiftKey: true }))).toBe('*');
    expect(chordOf(key({ key: '+' }))).toBe('Plus');
    expect(chordOf(key({ key: 'ArrowLeft', altKey: true }))).toBe('Alt+Left');
    expect(chordOf(key({ key: 'Control', ctrlKey: true }))).toBeNull();
  });

  it('reads the key left of 1 by where it is, in a Ctrl chord', () => {
    expect(chordOf(key({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+`');
  });

  it('knows a chord when it sees one', () => {
    expect(isChord('Ctrl+Shift+P')).toBe(true);
    expect(isChord('Shift+Ctrl+P')).toBe(false);
    expect(isChord('Ctrl')).toBe(false);
    expect(displayChord('Plus')).toBe('+');
  });
});

describe('UiKeymap', () => {
  it('answers with the first binding of a key, among the commands asked about', () => {
    const keymap = TestBed.inject(UiKeymap);
    keymap.set([
      { command: 'a', key: 'F5', when: 'panel' },
      { command: 'b', key: 'F5', when: 'panel' },
    ]);
    expect(keymap.commandFor(key({ key: 'F5' }), 'panel', ['a', 'b'])).toBe('a');
    expect(keymap.commandFor(key({ key: 'F5' }), 'panel', ['b'])).toBe('b');
    expect(keymap.commandFor(key({ key: 'F5' }), 'window', ['a', 'b'])).toBeNull();
    expect(keymap.keysFor('b')).toEqual(['F5']);
  });
});
