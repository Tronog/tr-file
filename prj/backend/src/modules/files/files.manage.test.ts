import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { HttpError, Logger } from '../../core/index.js';
import { FilePathResolver } from './file-path.resolver.js';
import { FilesService } from './files.service.js';

/**
 * PRD 003, §5 — the things every file manager has, in `FilesService`: rename,
 * new folder, new file and search, on a real disk.
 */

const TRASH = '.tr-file-trash';
const roots: string[] = [];

let root: string;
let service: FilesService;

async function status(run: Promise<unknown>): Promise<number> {
  try {
    await run;
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected an HttpError, got ${String(error)}`);
    return error.status;
  }
  assert.fail('expected the request to be refused');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-manage-'));
  roots.push(root);
  service = new FilesService(new FilePathResolver(root, [TRASH]), Logger.create('error'), 1024);
  await mkdir(join(root, 'docs', 'deep'), { recursive: true });
  await mkdir(join(root, 'other'));
  await writeFile(join(root, 'a.txt'), 'alpha');
  await writeFile(join(root, 'docs', 'b.md'), 'bravo');
});

after(async () => {
  await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
});

describe('FilesService.rename', () => {
  it('renames in place and describes the entry under its new name', async () => {
    const details = (await service.rename('a.txt', 'z.txt')).toJSON();

    assert.equal(details.path, 'z.txt');
    assert.equal(details.size, 5);
    assert.equal(await readFile(join(root, 'z.txt'), 'utf8'), 'alpha');
    assert.deepEqual((await readdir(root)).sort(), ['docs', 'other', 'z.txt']);
  });

  it('moves to another folder, as Undo of a move does', async () => {
    const details = (await service.rename('docs/b.md', 'other/b.md')).toJSON();

    assert.equal(details.path, 'other/b.md');
    assert.equal(details.parent, 'other');
    assert.deepEqual(await readdir(join(root, 'docs')), ['deep']);
  });

  it('refuses a taken name with 409, leaving both', async () => {
    await writeFile(join(root, 'taken.txt'), 'mine');

    assert.equal(await status(service.rename('a.txt', 'taken.txt')), 409);
    assert.equal(await readFile(join(root, 'taken.txt'), 'utf8'), 'mine');
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha');
  });

  it('allows a case-only rename, which a case-insensitive disk sees as the same entry', async () => {
    const details = (await service.rename('a.txt', 'A.txt')).toJSON();

    assert.equal(details.name, 'A.txt');
    assert.equal(await readFile(join(root, 'A.txt'), 'utf8'), 'alpha');
  });

  it('refuses a folder into itself or below itself', async () => {
    assert.equal(await status(service.rename('docs', 'docs/deep/docs')), 400);
    assert.equal(await status(service.rename('docs', 'docs/docs')), 400);
  });

  it('refuses the root, a missing folder, a folder that is a file, and a bad name', async () => {
    assert.equal(await status(service.rename('', 'x')), 400);
    assert.equal(await status(service.rename('a.txt', '')), 400);
    assert.equal(await status(service.rename('a.txt', 'docs/')), 400);
    assert.equal(await status(service.rename('a.txt', 'nowhere/a.txt')), 404);
    assert.equal(await status(service.rename('docs/b.md', 'a.txt/b.md')), 400);
    assert.equal(await status(service.rename('a.txt', 'docs/..')), 400);
    assert.equal(await status(service.rename('a.txt', 'a\\b')), 400);
    assert.equal(await status(service.rename('missing', 'x')), 404);
  });

  it('keeps out of the trash and out of the root', async () => {
    await mkdir(join(root, TRASH));

    assert.equal(await status(service.rename('a.txt', `${TRASH}/a.txt`)), 403);
    assert.equal(await status(service.rename(TRASH, 'visible')), 403);
    assert.equal(await status(service.rename('a.txt', '../a.txt')), 403);
  });

  it('renames a link as a link, even one that leads out of the root', async () => {
    await symlink('/', join(root, 'escape'));

    const details = (await service.rename('escape', 'renamed')).toJSON();

    assert.equal(details.type, 'symlink');
    assert.ok((await lstat(join(root, 'renamed'))).isSymbolicLink());
    assert.equal(await readlink(join(root, 'renamed')), '/');
  });
});

describe('FilesService.createFolder / createFile', () => {
  it('makes an empty folder and describes it', async () => {
    const details = (await service.createFolder('docs', 'New Folder')).toJSON();

    assert.equal(details.path, 'docs/New Folder');
    assert.equal(details.type, 'directory');
    assert.equal(details.entryCount, 0);
  });

  it('makes an empty file and describes it', async () => {
    const details = (await service.createFile('', 'notes.md')).toJSON();

    assert.equal(details.path, 'notes.md');
    assert.equal(details.type, 'file');
    assert.equal(details.size, 0);
    assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), '');
  });

  it('never replaces what is there', async () => {
    assert.equal(await status(service.createFile('', 'a.txt')), 409);
    assert.equal(await status(service.createFolder('', 'a.txt')), 409);
    assert.equal(await status(service.createFolder('', 'docs')), 409);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha');
  });

  it('refuses a bad name, a missing folder, and a folder that is a file', async () => {
    assert.equal(await status(service.createFolder('', '../up')), 400);
    assert.equal(await status(service.createFile('', '..')), 400);
    assert.equal(await status(service.createFile('', ' ')), 400);
    assert.equal(await status(service.createFolder('nowhere', 'x')), 404);
    assert.equal(await status(service.createFile('a.txt', 'x')), 400);
    assert.equal(await status(service.createFile(TRASH, 'x')), 403);
  });
});

describe('FilesService.search', () => {
  const names = (result: Awaited<ReturnType<FilesService['search']>>) => result.entries.map((entry) => entry.path);

  it('matches a substring of the name, case-insensitively, shallowest first', async () => {
    await writeFile(join(root, 'docs', 'deep', 'Alpha-notes.txt'), '');

    const result = await service.search('', 'ALPHA');

    assert.deepEqual(names(result), ['docs/deep/Alpha-notes.txt']);
    assert.deepEqual(names(await service.search('', '.txt')), ['a.txt', 'docs/deep/Alpha-notes.txt']);
    assert.equal(result.truncated, false);
    assert.equal(result.toJSON().query, 'ALPHA');
    assert.ok(result.scanned >= 5);
  });

  it('treats * and ? as a glob over the whole name', async () => {
    assert.deepEqual(names(await service.search('', '*.md')), ['docs/b.md']);
    assert.deepEqual(names(await service.search('', '?.TXT')), ['a.txt']);
    assert.deepEqual(names(await service.search('', 'a*')), ['a.txt']);
    assert.deepEqual(names(await service.search('', '*.m')), []);
    assert.deepEqual(names(await service.search('', 'b(1).md')), []);
  });

  it('searches beneath the folder it is given', async () => {
    const result = await service.search('docs', 'b');

    assert.equal(result.path, 'docs');
    assert.deepEqual(names(result), ['docs/b.md']);
  });

  it('stops at the limit and says there is more', async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, 'other', `hit-${index}.log`), '');
    }

    const limited = await service.search('', 'hit-', 3);
    assert.equal(limited.entries.length, 3);
    assert.equal(limited.truncated, true);

    const exact = await service.search('', 'hit-', 5);
    assert.equal(exact.entries.length, 5);
    assert.equal(exact.truncated, false);
  });

  it('reports a link, with what it leads to, but never walks into it', async () => {
    await symlink('docs', join(root, 'link-to-docs'));

    assert.deepEqual(names(await service.search('', 'b.md')), ['docs/b.md']);
    const link = (await service.search('', 'link')).entries[0]?.toJSON();
    assert.equal(link?.type, 'symlink');
    assert.equal(link?.targetType, 'directory');
  });

  it('skips the trash', async () => {
    await mkdir(join(root, TRASH, 'files'), { recursive: true });
    await writeFile(join(root, TRASH, 'files', 'alpha.txt'), '');

    assert.deepEqual(names(await service.search('', 'alpha')), []);
  });

  it('refuses an empty query, a bad limit, and a file to search in', async () => {
    assert.equal(await status(service.search('', '   ')), 400);
    assert.equal(await status(service.search('', 'a', 0)), 400);
    assert.equal(await status(service.search('a.txt', 'a')), 400);
    assert.equal(await status(service.search('nowhere', 'a')), 404);
    assert.equal(await status(service.search('..', 'a')), 403);
  });
});

describe('FilesService.localPath', () => {
  it('says where an entry is, what it is, and whether it runs', async () => {
    await writeFile(join(root, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });

    const script = await service.localPath('run.sh');
    assert.equal(script.absolute, join(root, 'run.sh'));
    assert.equal(script.type, 'file');
    assert.equal(script.executable, true);

    const folder = await service.localPath('docs');
    assert.equal(folder.type, 'directory');
    assert.equal(folder.executable, false);
    assert.equal((await service.localPath('a.txt')).executable, false);
    assert.equal(await status(service.localPath('missing')), 404);
  });
});
