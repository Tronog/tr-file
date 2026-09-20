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
