import { fsDirectory, fsEntry } from '../testing/fs-fixtures';
import { locationQuery, suggestPlaces } from './location-suggest';

/** PRD 004, §4.2 — what the path bar suggests for what is typed in it. */
describe('location suggestions', () => {
  it('reads what is typed as a folder and the start of a name in it', () => {
    expect(locationQuery('/docs/pr')).toEqual({ folder: 'docs', fragment: 'pr' });
    expect(locationQuery('docs/')).toEqual({ folder: 'docs', fragment: '' });
    expect(locationQuery('s:\\tronog\\Su')).toEqual({ folder: 's:/tronog', fragment: 'Su' });
    expect(locationQuery('C:')).toEqual({ folder: '', fragment: 'C:' });
    expect(locationQuery('/')).toEqual({ folder: '', fragment: '' });
    expect(locationQuery('/docs/../etc')).toBeNull();
  });

  it('suggests what fits, case ignored: folders first, then names that start with it, then that hold it', () => {
    const entries = [fsEntry('docs/Prd-notes.md'), fsDirectory('docs/prd'), fsEntry('docs/appendix-PR.txt'), fsDirectory('docs/other')];
    expect(suggestPlaces(entries, 'PR').map((entry) => entry.name)).toEqual(['prd', 'Prd-notes.md', 'appendix-PR.txt']);
    expect(suggestPlaces(entries, '*.md').map((entry) => entry.name)).toEqual(['Prd-notes.md']);
    expect(suggestPlaces(entries, '').map((entry) => entry.name)).toEqual(['other', 'prd', 'appendix-PR.txt', 'Prd-notes.md']);
    expect(suggestPlaces(entries, '', 2)).toHaveLength(2);
    expect(suggestPlaces(entries, 'zzz')).toEqual([]);
    // The very name typed first — what Enter opens — even before a folder.
    expect(suggestPlaces(entries, 'prd-NOTES.md').map((entry) => entry.name)).toEqual(['Prd-notes.md']);
    const typedWhole = [fsDirectory('docs/readme-old'), fsEntry('docs/README')];
    expect(suggestPlaces(typedWhole, 'readme').map((entry) => entry.name)).toEqual(['README', 'readme-old']);
  });
});
