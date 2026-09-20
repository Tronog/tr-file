import { TestBed } from '@angular/core/testing';
import type { MockFileNode } from '../mock-data/mock-data.model';
import { WorkbenchService } from '../workbench.service';
import type { FileViewModelFeature } from './file-view-model.feature';

function file(name: string, size: number | null = 0, extra: Partial<MockFileNode> = {}): MockFileNode {
  return { id: name, name, kind: 'file', size, modified: '2026-09-20T13:04:00Z', ...extra };
}

function directory(name: string, extra: Partial<MockFileNode> = {}): MockFileNode {
  return { id: name, name, kind: 'directory', size: null, modified: '2026-09-20T13:04:00Z', ...extra };
}

describe('FileViewModelFeature', () => {
  let files: FileViewModelFeature;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    files = TestBed.inject(WorkbenchService).fileViewModel;
  });

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
  });

  it('renders an em dash for directories, which have no size', () => {
    expect(files.sizeLabel(directory('prj'))).toBe('—');
    expect(files.sizeLabel(file('README.md', 3_482))).toBe('3.4 KB');
  });

  describe('timestamps', () => {
    it('formats the narrow column from UTC parts, without the year', () => {
      expect(files.modifiedLabel(file('a.ts', 1, { modified: '2026-09-20T13:04:00Z' }))).toBe('Sep 20, 13:04');
    });

    it('pads hours and minutes', () => {
      expect(files.modifiedLabel(file('a.ts', 1, { modified: '2026-01-02T03:05:00Z' }))).toBe('Jan 2, 03:05');
    });

    it('includes the year in the details timestamp', () => {
      expect(files.fullTimestamp('2026-09-20T13:11:00Z')).toBe('Sep 20, 2026 13:11');
    });

    it('reads the instant as UTC, not as host-local time', () => {
      expect(files.fullTimestamp('2026-12-31T23:59:00Z')).toBe('Dec 31, 2026 23:59');
    });
  });

  describe('tint', () => {
    it('tints directories as folders regardless of their name', () => {
      expect(files.tint(directory('styles.css'))).toBe('folder');
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
    expect(files.icon(directory('prj'))).toBe('folder');
    expect(files.icon(directory('prj'), true)).toBe('folder-open');
    expect(files.icon(file('a.ts'), true)).toBe('file');
  });

  it('labels the type column from the extension', () => {
    expect(files.typeLabel(directory('prj'))).toBe('Folder');
    expect(files.typeLabel(file('main.ts'))).toBe('TS');
    expect(files.typeLabel(file('Makefile'))).toBe('File');
  });

  describe('treeMeta', () => {
    it('prefers the git letter over any size or item count', () => {
      expect(files.treeMeta(file('package.json', 942, { decoration: 'modified' }), false)).toBe('M');
      expect(files.treeMeta(file('002.md', 612, { decoration: 'untracked' }), false)).toBe('U');
      expect(files.treeMeta(directory('src', { itemCount: 9, decoration: 'modified' }), true)).toBe('M');
    });

    it('counts items for collapsed directories, singular at one', () => {
      expect(files.treeMeta(directory('libs', { itemCount: 1 }), false)).toBe('1 item');
      expect(files.treeMeta(directory('backend', { itemCount: 12 }), false)).toBe('12 items');
    });

    it('shows nothing for expanded directories or directories with no count', () => {
      expect(files.treeMeta(directory('backend', { itemCount: 12 }), true)).toBeUndefined();
      expect(files.treeMeta(directory('frontend'), false)).toBeUndefined();
      expect(files.treeMeta(directory('empty', { itemCount: 0 }), false)).toBeUndefined();
    });

    it('shows a file size only once it reaches 1 KB', () => {
      expect(files.treeMeta(file('package.json', 942), false)).toBeUndefined();
      expect(files.treeMeta(file('tsconfig.json', 1_204), false)).toBe('1.2 KB');
      expect(files.treeMeta(directory('prj'), false)).toBeUndefined();
    });
  });
});
