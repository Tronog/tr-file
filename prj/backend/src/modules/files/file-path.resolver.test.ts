import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { HttpError } from '../../core/index.js';
import { FilePathResolver } from './file-path.resolver.js';

const ROOT = join('/tmp', 'tr-file-resolver-root');

describe('FilePathResolver', () => {
  const resolver = new FilePathResolver(ROOT);

  it('maps an empty or missing path to the root itself', () => {
    for (const input of [undefined, '', '   ', '/']) {
      const resolved = resolver.resolve(input);
      assert.equal(resolved.absolute, ROOT);
      assert.equal(resolved.relative, '');
    }
  });

  it('resolves a relative path beneath the root', () => {
    const resolved = resolver.resolve('docs/readme.md');
    assert.equal(resolved.absolute, join(ROOT, 'docs', 'readme.md'));
    assert.equal(resolved.relative, 'docs/readme.md');
  });

  it('treats a leading separator as root-relative, not host-absolute', () => {
    const resolved = resolver.resolve('/etc/passwd');
    assert.equal(resolved.absolute, join(ROOT, 'etc', 'passwd'));
    assert.equal(resolved.relative, 'etc/passwd');
  });

  it('collapses interior traversal that stays inside the root', () => {
    assert.equal(resolver.resolve('docs/../notes/a.txt').relative, 'notes/a.txt');
  });

  it('rejects traversal that escapes the root with 403', () => {
    for (const input of ['../outside', 'docs/../../outside', '/../outside']) {
      assert.throws(
        () => resolver.resolve(input),
        (error: unknown) => error instanceof HttpError && error.status === 403,
        `expected "${input}" to be rejected`,
      );
    }
  });

  it('rejects null bytes with 400', () => {
    assert.throws(
      () => resolver.resolve('a\0b'),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
  });

  it('reports host paths outside the root as not root-relative', () => {
    assert.equal(resolver.toRootRelative(join(ROOT, 'a', 'b')), 'a/b');
    assert.equal(resolver.toRootRelative(ROOT), '');
    assert.equal(resolver.toRootRelative('/etc/passwd'), null);
  });
});

describe('FilePathResolver over the whole file system (PRD 003, §6)', () => {
  it('resolves beneath / without a doubled separator', () => {
    const resolver = new FilePathResolver('/');
    assert.equal(resolver.resolve('home/me').absolute, '/home/me');
    assert.equal(resolver.resolve('home/me').relative, 'home/me');
    assert.equal(resolver.resolve('').absolute, '/');
    assert.equal(resolver.toRootRelative('/media/usb'), 'media/usb');
    assert.equal(resolver.toRootRelative('/'), '');
    assert.equal(resolver.resolve('../..').relative, '');
  });
});

describe('FilePathResolver.drives (PRD 003, §6)', () => {
  const resolver = FilePathResolver.drives();

  it('has the list of drives as its root, which is nothing on disk', () => {
    const root = resolver.resolve('');
    assert.equal(root.absolute, '');
    assert.equal(root.relative, '');
    assert.equal(resolver.isRoot(''), true);
    assert.equal(resolver.isRoot('C:'), true);
    assert.equal(resolver.isRoot('C:/Users'), false);
  });

  it('maps the first segment to a drive', () => {
    assert.equal(resolver.resolve('C:').absolute, 'C:\\');
    assert.equal(resolver.resolve('c:/Users/me').absolute, 'C:\\Users\\me');
    assert.equal(resolver.resolve('c:/Users/me').relative, 'C:/Users/me');
    assert.equal(resolver.resolve('D:\\Photos\\2024').relative, 'D:/Photos/2024');
  });

  it('stays on the drive for traversal', () => {
    assert.equal(resolver.resolve('C:/../../Windows').relative, 'C:/Windows');
  });

  it('refuses what is not a drive, and a colon after one', () => {
    assert.throws(() => resolver.resolve('Users'), (error: unknown) => error instanceof HttpError && error.status === 404);
    assert.throws(() => resolver.resolve('C:/D:/x'), (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.throws(() => resolver.resolve('C:/a.txt:stream'), (error: unknown) => error instanceof HttpError && error.status === 400);
  });

  it('reports host paths on any drive, and nothing else', () => {
    assert.equal(resolver.toRootRelative('d:\\Music\\'), 'D:/Music');
    assert.equal(resolver.toRootRelative('E:\\'), 'E:');
    assert.equal(resolver.toRootRelative('\\\\server\\share\\x'), null);
  });
});

/**
 * PRD 004, §4.1 — `s:\tronog` typed for `S:\Tronog`: on a drive mapped to a
 * share the real path is the share's, and the path asked for takes its case.
 */
describe('FilePathResolver.caseFromShare', () => {
  it('spells the path as the share does, keeping the drive', () => {
    assert.equal(FilePathResolver.caseFromShare('S:\\tronog\\sub', '\\\\server\\share\\Tronog\\Sub'), 'S:\\Tronog\\Sub');
    // A drive mapped to a folder inside the share: only as many segments as were asked for.
    assert.equal(FilePathResolver.caseFromShare('S:\\tronog', '\\\\server\\share\\deep\\Tronog'), 'S:\\Tronog');
  });

  it('leaves alone what differs by more than case, or is already right', () => {
    assert.equal(FilePathResolver.caseFromShare('S:\\link\\sub', '\\\\server\\share\\target\\Sub'), null);
    assert.equal(FilePathResolver.caseFromShare('S:\\', '\\\\server\\share'), null);
    assert.equal(FilePathResolver.caseFromShare('S:\\Tronog', '\\\\server\\share\\Tronog'), null);
  });
});
