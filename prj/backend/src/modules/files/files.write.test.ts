import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { HttpError, Logger } from '../../core/index.js';
import { contentTag } from './content-tag.js';
import { FilePathResolver } from './file-path.resolver.js';
import { FilesService } from './files.service.js';

/** PRD 005, §4 — the editor's Save: `FilesService.writeFile`, on a real disk. */

const roots: string[] = [];
let root: string;
let service: FilesService;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function failure(run: Promise<unknown>): Promise<HttpError> {
  try {
    await run;
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected an HttpError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the write to be refused');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-write-'));
  roots.push(root);
  service = new FilesService(new FilePathResolver(root, ['.tr-file-trash']), Logger.create('error'), 64);
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'a.md'), '# alpha\n');
});

after(async () => {
  await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
});

describe('contentTag', () => {
  // The frontend's `content-tag.ts` is pinned by the same three.
  it('is the length and 64 bits of cyrb53', () => {
    assert.equal(contentTag(new Uint8Array()), '0:488bdcb81aee8d83');
    assert.equal(contentTag(bytes('hello\n')), '6:41407a367a4ce3d6');
    assert.equal(contentTag(bytes('héllo, wörld')), '14:379a0f8293280947');
  });
});

describe('FilesService.writeFile', () => {
  it('replaces the content, leaves no temporary file, and describes the file', async () => {
    const details = (await service.writeFile('docs/a.md', bytes('# beta\n'))).toJSON();

    assert.equal(details.path, 'docs/a.md');
    assert.equal(details.size, 7);
    assert.equal(await readFile(join(root, 'docs', 'a.md'), 'utf8'), '# beta\n');
    assert.deepEqual(await readdir(join(root, 'docs')), ['a.md']);
  });

  it('writes when the file is still what was read, and refuses with CHANGED when it is not', async () => {
    await service.writeFile('docs/a.md', bytes('one'), contentTag(bytes('# alpha\n')));
    assert.equal(await readFile(join(root, 'docs', 'a.md'), 'utf8'), 'one');

    const changed = await failure(service.writeFile('docs/a.md', bytes('two'), contentTag(bytes('# alpha\n'))));
    assert.equal(changed.status, 409);
    assert.equal(changed.code, 'CHANGED');
    assert.equal(await readFile(join(root, 'docs', 'a.md'), 'utf8'), 'one');
  });

  it('keeps the permissions', { skip: process.platform === 'win32' }, async () => {
    await chmod(join(root, 'docs', 'a.md'), 0o750);
    await service.writeFile('docs/a.md', bytes('#!/bin/sh\n'));
    assert.equal((await stat(join(root, 'docs', 'a.md'))).mode & 0o7777, 0o750);
  });

  it('writes through a link, which stays a link', { skip: process.platform === 'win32' }, async () => {
    await symlink('docs/a.md', join(root, 'link.md'));
    await service.writeFile('link.md', bytes('through'));

    assert.ok((await lstat(join(root, 'link.md'))).isSymbolicLink());
    assert.equal(await readFile(join(root, 'docs', 'a.md'), 'utf8'), 'through');
  });

  it('writes in place over a file with other hard links, so they see it too', async () => {
    await link(join(root, 'docs', 'a.md'), join(root, 'hard.md'));
    await service.writeFile('docs/a.md', bytes('shared'));
    assert.equal(await readFile(join(root, 'hard.md'), 'utf8'), 'shared');
  });

  it('refuses a folder, a missing file, too much, and a path out of the root', async () => {
    assert.equal((await failure(service.writeFile('docs', bytes('x')))).status, 400);
    assert.equal((await failure(service.writeFile('docs/none.md', bytes('x')))).status, 404);
    assert.equal((await failure(service.writeFile('docs/a.md', new Uint8Array(65)))).status, 413);
    assert.equal((await failure(service.writeFile('../out.md', bytes('x')))).status, 403);
    assert.equal(await readFile(join(root, 'docs', 'a.md'), 'utf8'), '# alpha\n');
  });
});
