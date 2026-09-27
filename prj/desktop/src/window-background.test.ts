import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DARK_BACKGROUND, LIGHT_BACKGROUND, windowBackground } from './window-background.js';

describe('windowBackground (PRD 010, §4)', () => {
  it('is dark with nothing stored, or anything else', () => {
    assert.equal(windowBackground({}, true), DARK_BACKGROUND);
    assert.equal(windowBackground({ 'tr-file.preferences.v1': 'junk' }, true), DARK_BACKGROUND);
    assert.equal(windowBackground({ 'tr-file.preferences.v1': { 'workbench.colorTheme': 'dark' } }, true), DARK_BACKGROUND);
  });

  it('is light for the light theme, and for the system one when the OS prefers light', () => {
    assert.equal(windowBackground({ 'tr-file.preferences.v1': { 'workbench.colorTheme': 'light' } }, false), LIGHT_BACKGROUND);
    assert.equal(windowBackground({ 'tr-file.preferences.v1': { 'workbench.colorTheme': 'system' } }, true), LIGHT_BACKGROUND);
    assert.equal(windowBackground({ 'tr-file.preferences.v1': { 'workbench.colorTheme': 'system' } }, false), DARK_BACKGROUND);
  });
});
