import { isAbsoluteShown, shownPath } from './fs-path';

/** PRD 004, §1.4 — a Windows path is shown as Windows writes it, never from `/`. */
describe('shownPath', () => {
  it('shows a path from the root', () => {
    expect(shownPath('')).toBe('/');
    expect(shownPath('docs/prd')).toBe('/docs/prd');
  });

  it('shows a drive, and a path on one, without a leading /', () => {
    expect(shownPath('C:')).toBe('C:');
    expect(shownPath('C:/Windows')).toBe('C:/Windows');
    expect(shownPath('d:/Users/me')).toBe('d:/Users/me');
  });

  /** Only a drive is a drive: a name with a colon further on is an ordinary folder. */
  it('keeps the / for names that only look like drives', () => {
    expect(shownPath('C:x')).toBe('/C:x');
    expect(shownPath('ab:/c')).toBe('/ab:/c');
  });
});

describe('isAbsoluteShown', () => {
  it('takes a path from / or from a drive, either separator', () => {
    expect(isAbsoluteShown('/docs')).toBe(true);
    expect(isAbsoluteShown('C:/Windows')).toBe(true);
    expect(isAbsoluteShown('C:\\Windows')).toBe(true);
    expect(isAbsoluteShown('C:')).toBe(true);
  });

  it('refuses a relative one', () => {
    expect(isAbsoluteShown('docs')).toBe(false);
    expect(isAbsoluteShown('C:x')).toBe(false);
  });
});
