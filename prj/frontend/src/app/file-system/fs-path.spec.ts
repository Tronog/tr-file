import { isAbsoluteShown, shownPath, unixPath } from './fs-path';

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

/** PRD 004, §1.3.2 — `Ctrl`+`Shift`+`C` twice: the drive as a folder, every `\` a `/`. */
describe('unixPath', () => {
  it('turns a drive into a folder of the root', () => {
    expect(unixPath('C:\\')).toBe('/C/');
    expect(unixPath('C:\\Users\\me\\a b.txt')).toBe('/C/Users/me/a b.txt');
    expect(unixPath('T:\\')).toBe('/T/');
    expect(unixPath('T:')).toBe('/T');
    expect(unixPath('d:/work')).toBe('/d/work');
  });

  it('turns backslashes into slashes elsewhere too, a share and all', () => {
    expect(unixPath('\\\\server\\share\\x')).toBe('//server/share/x');
  });

  it('leaves a UNIX path as it is', () => {
    expect(unixPath('/home/me/docs')).toBe('/home/me/docs');
    expect(unixPath('/')).toBe('/');
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
