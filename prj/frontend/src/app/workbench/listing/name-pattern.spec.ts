import { namePattern, patternProblem } from './name-pattern';

describe('namePattern (PRD 004, §2)', () => {
  it('matches the whole name, with * and ?', () => {
    const match = namePattern('*.txt');
    expect(match('notes.txt')).toBe(true);
    expect(match('notes.txt.bak')).toBe(false);
    expect(namePattern('a?c')('abc')).toBe(true);
    expect(namePattern('a?c')('abbc')).toBe(false);
  });

  it('ignores case', () => {
    expect(namePattern('*.JPG')('photo.jpg')).toBe(true);
  });

  it('takes several patterns separated by ;', () => {
    const match = namePattern('*.jpg; *.png');
    expect(match('a.png')).toBe(true);
    expect(match('a.gif')).toBe(false);
  });

  it('reads [...] as a set, and [!...] as its complement', () => {
    expect(namePattern('file[12].txt')('file2.txt')).toBe(true);
    expect(namePattern('file[12].txt')('file3.txt')).toBe(false);
    expect(namePattern('file[!12].txt')('file3.txt')).toBe(true);
  });

  it('takes every other character literally', () => {
    expect(namePattern('a+b (1).txt')('a+b (1).txt')).toBe(true);
    expect(namePattern('a.b')('axb')).toBe(false);
    expect(namePattern('[oops')('[oops')).toBe(true);
  });

  it('says so when there is no pattern', () => {
    expect(patternProblem(' ; ')).not.toBeNull();
    expect(patternProblem('*')).toBeNull();
  });
});
