import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { HttpError, Logger } from '../../core/index.js';
import { FilePathResolver } from './file-path.resolver.js';
import { FilesService } from './files.service.js';

const UPLOAD_LIMIT = 64;

let root: string;
let service: FilesService;

/** Asserts that `run` rejects with an `HttpError` carrying `status`. */
async function assertHttpStatus(run: () => Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof HttpError, `expected an HttpError, got ${String(error)}`);
    assert.equal(error.status, status);
    return true;
  });
}

function streamOf(content: string): Readable {
  return Readable.from([Buffer.from(content, 'utf8')]);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-service-'));
  service = new FilesService(
    new FilePathResolver(root),
    // Errors only: the tests deliberately provoke warnings.
    Logger.create('error'),
    UPLOAD_LIMIT,
  );

  await mkdir(join(root, 'zeta'));
  await mkdir(join(root, 'alpha'));
  await mkdir(join(root, 'alpha', 'nested'));
  await writeFile(join(root, 'alpha', 'nested', 'deep.txt'), 'deep');
  await writeFile(join(root, 'b.txt'), 'hello');
  await writeFile(join(root, 'A.md'), '# title');
  await writeFile(join(root, '.hidden'), 'x');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FilesService.listDirectory', () => {
  it('lists the root with directories first, then files, case-insensitively', async () => {
    const dto = (await service.listDirectory(undefined)).toJSON();

    assert.equal(dto.path, '');
    assert.equal(dto.parent, null);
    assert.deepEqual(
      dto.entries.map((entry) => entry.name),
      ['alpha', 'zeta', '.hidden', 'A.md', 'b.txt'],
    );
  });

  it('describes each entry with its type, size and hidden flag', async () => {
    const entries = (await service.listDirectory('')).toJSON().entries;
    const hidden = entries.find((entry) => entry.name === '.hidden');
    const text = entries.find((entry) => entry.name === 'b.txt');

    assert.ok(hidden !== undefined && text !== undefined);
    assert.equal(hidden.hidden, true);
    assert.equal(text.hidden, false);
    assert.equal(text.type, 'file');
    assert.equal(text.size, 5);
    assert.equal(text.path, 'b.txt');
  });

  it('reports the parent of a nested directory', async () => {
    const dto = (await service.listDirectory('alpha/nested')).toJSON();
    assert.equal(dto.path, 'alpha/nested');
    assert.equal(dto.parent, 'alpha');
    assert.deepEqual(
      dto.entries.map((entry) => entry.name),
      ['deep.txt'],
    );
  });

  it('rejects listing a file with 400', async () => {
    await assertHttpStatus(() => service.listDirectory('b.txt'), 400);
  });

  it('reports a missing path as 404', async () => {
    await assertHttpStatus(() => service.listDirectory('nope/at/all'), 404);
  });

  it('reports an escaping path as 403', async () => {
    await assertHttpStatus(() => service.listDirectory('../..'), 403);
  });
});

/**
 * PRD 003, §1 — natural order, and symlinks judged by what they lead to. A tree
 * of its own, so the listing assertions above stay about theirs.
 */
describe('FilesService with symlinks and numbered names', () => {
  let linkRoot: string;
  let outside: string;
  let links: FilesService;

  before(async () => {
    linkRoot = await mkdtemp(join(tmpdir(), 'tr-file-links-'));
    outside = await mkdtemp(join(tmpdir(), 'tr-file-outside-'));
    links = new FilesService(new FilePathResolver(linkRoot), Logger.create('error'), UPLOAD_LIMIT);

    await mkdir(join(linkRoot, 'real'));
    await writeFile(join(linkRoot, 'real', 'inside.txt'), 'inside');
    for (const name of ['file10.txt', 'file2.txt', 'File1.txt']) {
      await writeFile(join(linkRoot, name), name);
    }
    await symlink(join(linkRoot, 'real'), join(linkRoot, 'folder-link'));
    await symlink(join(linkRoot, 'file2.txt'), join(linkRoot, 'file-link'));
    await symlink(join(linkRoot, 'gone'), join(linkRoot, 'dangling'));
    await symlink(outside, join(linkRoot, 'escape'));
  });

  after(async () => {
    await rm(linkRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const entry = async (name: string) => {
    const found = (await links.listDirectory('')).toJSON().entries.find((candidate) => candidate.name === name);
    assert.ok(found !== undefined, `no entry named ${name}`);
    return found;
  };

  it('sorts numbered names naturally, links to folders among the folders', async () => {
    const names = (await links.listDirectory('')).toJSON().entries.map((candidate) => candidate.name);

    assert.deepEqual(names, [
      'folder-link',
      'real',
      'dangling',
      'escape',
      // Punctuation sorts before digits, as in every collation-aware file manager.
      'file-link',
      'File1.txt',
      'file2.txt',
      'file10.txt',
    ]);
  });

  it('says what each link leads to', async () => {
    assert.equal((await entry('folder-link')).targetType, 'directory');
    assert.equal((await entry('file-link')).targetType, 'file');
    // Nothing reachable: a dangling link, and one that leaves the root.
    assert.equal((await entry('dangling')).targetType, null);
    assert.equal((await entry('escape')).targetType, null);
    // Anything that is not a link carries no target at all.
    assert.equal('targetType' in (await entry('real')), false);
  });

  it('lists a folder through a link to it, keeping the link in the paths', async () => {
    const dto = (await links.listDirectory('folder-link')).toJSON();

    assert.equal(dto.path, 'folder-link');
    assert.deepEqual(
      dto.entries.map((candidate) => candidate.path),
      ['folder-link/inside.txt'],
    );
  });

  it('describes a link to a folder as one, with its contents counted', async () => {
    const dto = (await links.getDetails('folder-link')).toJSON();

    assert.equal(dto.type, 'symlink');
    assert.equal(dto.targetType, 'directory');
    assert.equal(dto.entryCount, 1);
    assert.equal(dto.mimeType, null);
  });

  it('downloads a link to a file as the file, with its real size', async () => {
    const target = await links.resolveDownload('file-link');

    assert.equal(target.size, 'file2.txt'.length);
  });

  it('refuses to download a link to a folder, and to follow one out of the root', async () => {
    await assertHttpStatus(() => links.resolveDownload('folder-link'), 400);
    await assertHttpStatus(() => links.listDirectory('escape'), 403);
  });
});

describe('FilesService.getDetails', () => {
  it('describes a file', async () => {
    const dto = (await service.getDetails('b.txt')).toJSON();

    assert.equal(dto.name, 'b.txt');
    assert.equal(dto.path, 'b.txt');
    assert.equal(dto.parent, '');
    assert.equal(dto.type, 'file');
    assert.equal(dto.size, 5);
    assert.equal(dto.mimeType, 'text/plain');
    assert.equal(dto.entryCount, null);
    assert.equal(dto.symlinkTarget, null);
    assert.match(dto.mode, /^[0-7]{4}$/);
    assert.equal(typeof dto.inode, 'number');
    assert.equal(dto.sizeOnDisk % 512, 0);
    assert.equal(dto.permissions.owner.read, true);
  });

  it('counts the children of a directory', async () => {
    const dto = (await service.getDetails('alpha')).toJSON();

    assert.equal(dto.type, 'directory');
    assert.equal(dto.entryCount, 1);
    assert.equal(dto.mimeType, null);
    assert.equal(dto.parent, '');
  });

  it('reports the root itself', async () => {
    const dto = (await service.getDetails('')).toJSON();
    assert.equal(dto.name, '');
    assert.equal(dto.path, '');
    assert.equal(dto.parent, null);
    assert.equal(dto.type, 'directory');
    assert.equal(dto.entryCount, 5);
  });

  it('reports a missing path as 404', async () => {
    await assertHttpStatus(() => service.getDetails('missing.txt'), 404);
  });
});

describe('FilesService.resolveDownload', () => {
  it('returns the absolute path, name, size and mime type of a file', async () => {
    const target = await service.resolveDownload('A.md');
    assert.equal(target.absolutePath, join(root, 'A.md'));
    assert.equal(target.name, 'A.md');
    assert.equal(target.size, 7);
    assert.equal(target.mimeType, 'text/markdown');
  });

  it('rejects a directory with 400', async () => {
    await assertHttpStatus(() => service.resolveDownload('alpha'), 400);
  });

  it('reports a missing file as 404', async () => {
    await assertHttpStatus(() => service.resolveDownload('alpha/none.bin'), 404);
  });
});

describe('FilesService.saveUpload', () => {
  it('writes the streamed bytes and returns the stored file details', async () => {
    const details = await service.saveUpload({
      directoryPath: 'zeta',
      filename: 'note.txt',
      content: streamOf('uploaded'),
      overwrite: false,
    });
    const dto = details.toJSON();

    assert.equal(dto.path, 'zeta/note.txt');
    assert.equal(dto.name, 'note.txt');
    assert.equal(dto.size, 8);
    assert.equal(dto.mimeType, 'text/plain');
    assert.equal(await readFile(join(root, 'zeta', 'note.txt'), 'utf8'), 'uploaded');
  });

  it('refuses an existing target with 409 and leaves it untouched', async () => {
    await assertHttpStatus(
      () =>
        service.saveUpload({
          directoryPath: 'zeta',
          filename: 'note.txt',
          content: streamOf('replacement'),
          overwrite: false,
        }),
      409,
    );
    assert.equal(await readFile(join(root, 'zeta', 'note.txt'), 'utf8'), 'uploaded');
  });

  it('replaces the target when overwrite is requested', async () => {
    const details = await service.saveUpload({
      directoryPath: 'zeta',
      filename: 'note.txt',
      content: streamOf('replaced'),
      overwrite: true,
    });

    assert.equal(details.toJSON().size, 8);
    assert.equal(await readFile(join(root, 'zeta', 'note.txt'), 'utf8'), 'replaced');
  });

  it('rejects an oversized upload with 413 and leaves nothing behind', async () => {
    await assertHttpStatus(
      () =>
        service.saveUpload({
          directoryPath: 'zeta',
          filename: 'big.bin',
          content: streamOf('x'.repeat(UPLOAD_LIMIT + 1)),
          overwrite: false,
        }),
      413,
    );

    const names = (await service.listDirectory('zeta')).toJSON().entries.map((e) => e.name);
    assert.deepEqual(names, ['note.txt']);
  });

  it('rejects unsafe file names with 400', async () => {
    for (const filename of ['', '   ', '.', '..', 'a/b.txt', 'a\\b.txt', 'a\0b']) {
      await assertHttpStatus(
        () =>
          service.saveUpload({
            directoryPath: 'zeta',
            filename,
            content: streamOf('x'),
            overwrite: false,
          }),
        400,
      );
    }
  });

  it('rejects an upload into a file or a missing directory', async () => {
    await assertHttpStatus(
      () =>
        service.saveUpload({
          directoryPath: 'b.txt',
          filename: 'x.txt',
          content: streamOf('x'),
          overwrite: false,
        }),
      400,
    );
    await assertHttpStatus(
      () =>
        service.saveUpload({
          directoryPath: 'no-such-dir',
          filename: 'x.txt',
          content: streamOf('x'),
          overwrite: false,
        }),
      404,
    );
  });
});
