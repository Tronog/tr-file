import { fsDirectory, fsEntry } from '../testing/fs-fixtures';
import { FileViewModelFeature } from './file-view-model.feature';

describe('FileViewModelFeature', () => {
  let files: FileViewModelFeature;

  beforeEach(() => {
    // The formatter owns no state and talks to nothing, so it needs no TestBed.
    files = new FileViewModelFeature();
  });

  const file = (name: string, size = 0, modifiedAt = '2026-09-20T13:04:00.000Z') =>
    fsEntry(name, { size, modifiedAt });

  describe('formatBytes', () => {
    it('reports plain bytes below 1 KB', () => {
      expect(files.formatBytes(0)).toBe('0 B');
      expect(files.formatBytes(942)).toBe('942 B');
      expect(files.formatBytes(1023)).toBe('1023 B');
    });

    it('switches to KB at 1024 bytes with one decimal under 10 KB', () => {
      expect(files.formatBytes(1024)).toBe('1.0 KB');
      expect(files.formatBytes(1126)).toBe('1.1 KB');
      expect(files.formatBytes(9 * 1024)).toBe('9.0 KB');
    });

    it('rounds to whole KB from 10 KB up', () => {
      expect(files.formatBytes(10 * 1024)).toBe('10 KB');
      expect(files.formatBytes(45_056)).toBe('44 KB');
      expect(files.formatBytes(325_632)).toBe('318 KB');
    });

    it('switches to MB at 1024 KB, keeping the one-decimal rule', () => {
      expect(files.formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(files.formatBytes(Math.round(2.5 * 1024 * 1024))).toBe('2.5 MB');
      expect(files.formatBytes(12 * 1024 * 1024)).toBe('12 MB');
    });

    it('switches to GB at 1024 MB', () => {
      expect(files.formatBytes(1024 ** 3)).toBe('1.0 GB');
      expect(files.formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    });
  });

  it('renders an em dash for directories, which have no size of their own', () => {
    expect(files.sizeLabel(fsDirectory('prj'))).toBe('—');
    expect(files.sizeLabel(file('README.md', 3482))).toBe('3.4 KB');
  });

  describe('timestamps', () => {
    it('formats the narrow column from UTC parts, without the year', () => {
      expect(files.modifiedLabel(file('a.ts', 1, '2026-09-20T13:04:00.000Z'))).toBe('Sep 20, 13:04');
    });

    it('pads hours and minutes', () => {
      expect(files.modifiedLabel(file('a.ts', 1, '2026-01-02T03:05:00.000Z'))).toBe('Jan 2, 03:05');
    });

    it('includes the year in the details timestamp', () => {
      expect(files.fullTimestamp('2026-09-20T13:11:00.000Z')).toBe('Sep 20, 2026 13:11');
    });

    it('reads the instant as UTC, not as host-local time', () => {
      expect(files.fullTimestamp('2026-12-31T23:59:00.000Z')).toBe('Dec 31, 2026 23:59');
    });
  });

  describe('tint', () => {
    it('tints directories as folders regardless of their name', () => {
      expect(files.tint(fsDirectory('styles.css'))).toBe('folder');
    });

    it('maps known extensions, case insensitively', () => {
      expect(files.tint(file('main.ts'))).toBe('ts');
      expect(files.tint(file('main.mts'))).toBe('ts');
      expect(files.tint(file('app.js'))).toBe('ts');
      expect(files.tint(file('package.json'))).toBe('json');
      expect(files.tint(file('compose.dev.yaml'))).toBe('yaml');
      expect(files.tint(file('compose.yml'))).toBe('yaml');
      expect(files.tint(file('README.MD'))).toBe('md');
      expect(files.tint(file('theme.scss'))).toBe('css');
      expect(files.tint(file('index.html'))).toBe('html');
      expect(files.tint(file('hero.png'))).toBe('img');
    });

    it('falls back to generic for unknown and extension-less names', () => {
      expect(files.tint(file('notes.xyz'))).toBe('generic');
      expect(files.tint(file('Makefile'))).toBe('generic');
      expect(files.tint(file('.gitignore'))).toBe('generic');
    });
  });

  it('picks the open folder icon only for expanded directories', () => {
    expect(files.icon(fsDirectory('prj'))).toBe('folder');
    expect(files.icon(fsDirectory('prj'), true)).toBe('folder-open');
    expect(files.icon(file('a.ts'), true)).toBe('file');
  });

  describe('typeLabel', () => {
    it('labels files from their extension', () => {
      expect(files.typeLabel(file('main.ts'))).toBe('TS');
      expect(files.typeLabel(file('Makefile'))).toBe('File');
    });

    it('labels the other entry types the backend reports', () => {
      expect(files.typeLabel(fsDirectory('prj'))).toBe('Folder');
      expect(files.typeLabel(fsEntry('link', { type: 'symlink' }))).toBe('Link');
      expect(files.typeLabel(fsEntry('pipe', { type: 'other' }))).toBe('Special');
    });

    it('names a bare type through kindLabel', () => {
      expect(files.kindLabel('directory')).toBe('Folder');
      expect(files.kindLabel('symlink')).toBe('Link');
      expect(files.kindLabel('file')).toBe('File');
    });
  });

  describe('treeMeta', () => {
    it('shows a file size only once it reaches 1 KB', () => {
      expect(files.treeMeta(file('package.json', 942))).toBeUndefined();
      expect(files.treeMeta(file('tsconfig.json', 1_204))).toBe('1.2 KB');
    });

    it('shows nothing for a directory, whatever size the backend reports', () => {
      // A listing does not carry its children's counts, so the tree stays bare
      // rather than fanning out a request per folder.
      expect(files.treeMeta(fsDirectory('prj'))).toBeUndefined();
      expect(files.treeMeta(fsDirectory('prj', { size: 65_536 }))).toBeUndefined();
    });
  });
});
