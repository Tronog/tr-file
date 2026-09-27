import { fsDirectory, fsEntry } from '../testing/fs-fixtures';
import { nameFilter, sortEntries } from './listing-order';

/** PRD 003, §5 — sorting a listing by its columns, and filtering it by name. */
describe('listing order', () => {
  const docs = fsDirectory('docs', { modifiedAt: '2026-01-01T00:00:00.000Z' });
  const assets = fsDirectory('assets', { modifiedAt: '2026-03-01T00:00:00.000Z' });
  const big = fsEntry('big.zip', { size: 9000, modifiedAt: '2026-02-01T00:00:00.000Z' });
  const file10 = fsEntry('file10.txt', { size: 10, modifiedAt: '2026-05-01T00:00:00.000Z' });
  const file2 = fsEntry('file2.txt', { size: 10, modifiedAt: '2026-04-01T00:00:00.000Z' });
  const entries = [file10, docs, big, file2, assets];
  const type = (entry: { name: string }): string => entry.name.split('.').at(-1)?.toUpperCase() ?? '';
  const order = (key: 'name' | 'size' | 'type' | 'modified', direction: 'asc' | 'desc' = 'asc'): string[] =>
    sortEntries(entries, { key, direction }, type).map((entry) => entry.name);

  it('keeps folders first, and names in natural order', () => {
    expect(order('name')).toEqual(['assets', 'docs', 'big.zip', 'file2.txt', 'file10.txt']);
  });

  it('turns only the rest round when descending — folders stay first', () => {
    expect(order('name', 'desc')).toEqual(['docs', 'assets', 'file10.txt', 'file2.txt', 'big.zip']);
  });

  it('sorts by size, breaking ties by name; folders by name', () => {
    expect(order('size')).toEqual(['assets', 'docs', 'file2.txt', 'file10.txt', 'big.zip']);
    expect(order('size', 'desc')).toEqual(['assets', 'docs', 'big.zip', 'file2.txt', 'file10.txt']);
  });

  it('sorts by the date modified and by the type label', () => {
    expect(order('modified')).toEqual(['docs', 'assets', 'big.zip', 'file2.txt', 'file10.txt']);
    expect(order('type')).toEqual(['assets', 'docs', 'file2.txt', 'file10.txt', 'big.zip']);
  });

  it('filters by a substring, ignoring case', () => {
    const matches = nameFilter('  FILE ');
    expect(entries.filter((entry) => matches(entry.name)).map((entry) => entry.name)).toEqual(['file10.txt', 'file2.txt']);
    expect(nameFilter('')('anything')).toBe(true);
  });

  it('filters by a glob when there is a * or ? in it', () => {
    expect(nameFilter('*.txt')('file2.txt')).toBe(true);
    expect(nameFilter('*.txt')('file2.txt.bak')).toBe(false);
    expect(nameFilter('file?.txt')('file2.txt')).toBe(true);
    expect(nameFilter('file?.txt')('file10.txt')).toBe(false);
    // The rest of the pattern is literal: a dot is a dot, a bracket a bracket.
    expect(nameFilter('a.(b)*')('a.(b)c')).toBe(true);
    expect(nameFilter('a.(b)*')('axbc')).toBe(false);
  });
});
