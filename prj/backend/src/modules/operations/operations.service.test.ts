import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { HttpError, Logger } from '../../core/index.js';
import { FilePathResolver } from '../files/index.js';
import type { OperationJobDto, TrashProvider } from './operation.model.js';
import { OperationsService } from './operations.service.js';
import { SERVER_TRASH_DIR, ServerTrash } from './server-trash.js';

/** PRD 005, §1 — copy, move, trash and empty trash as background jobs, on a real disk. */

const SILENT = Logger.create('error');
const roots: string[] = [];

let root: string;
let service: OperationsService;

async function fresh(trash?: (root: string) => TrashProvider): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'tr-file-ops-'));
  roots.push(root);
  const provider = trash?.(root) ?? new ServerTrash(root);
  service = new OperationsService(
    new FilePathResolver(root, provider.kind === 'server' ? [SERVER_TRASH_DIR] : []),
    provider,
    SILENT,
  );
  await mkdir(join(root, 'docs', 'deep'), { recursive: true });
  await mkdir(join(root, 'target'));
  await writeFile(join(root, 'a.txt'), 'alpha');
  await writeFile(join(root, 'docs', 'b.md'), 'bravo');
  await writeFile(join(root, 'docs', 'deep', 'c.bin'), Buffer.alloc(4096, 7));
}

/** Waits for a job to end, the way a client polls — just faster. */
async function settled(job: OperationJobDto): Promise<OperationJobDto> {
  for (;;) {
    const now = service.status(job.id);
    if (now.state !== 'running') {
      return now;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function refused(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected an HttpError, got ${String(error)}`);
    return error;
  }
  assert.fail('expected the request to be refused');
}

beforeEach(async () => {
  await fresh();
});

after(async () => {
  await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
});

describe('copy', () => {
  it('copies files and folders, counting bytes and items', async () => {
    const job = await settled(
      await service.start({ kind: 'copy', sources: ['a.txt', 'docs'], destination: 'target', conflict: 'fail' }),
    );

    assert.equal(job.state, 'done');
    assert.equal(await readFile(join(root, 'target', 'a.txt'), 'utf8'), 'alpha');
    assert.equal(await readFile(join(root, 'target', 'docs', 'b.md'), 'utf8'), 'bravo');
    assert.equal((await readFile(join(root, 'target', 'docs', 'deep', 'c.bin'))).length, 4096);
    assert.equal(job.totalBytes, 5 + 5 + 4096);
    assert.equal(job.doneBytes, job.totalBytes);
    assert.equal(job.totalItems, 5); // a.txt, docs, b.md, deep, c.bin
    assert.equal(job.doneItems, 5);
    assert.deepEqual(job.affected, ['target']);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha', 'the source stays');
  });

  it('refuses up front, naming every clash, when told to fail', async () => {
    await writeFile(join(root, 'target', 'a.txt'), 'old');
    await mkdir(join(root, 'target', 'docs'));

    const error = await refused(
      service.start({ kind: 'copy', sources: ['a.txt', 'docs'], destination: 'target', conflict: 'fail' }),
    );

    assert.equal(error.status, 409);
    assert.deepEqual((error.details as { conflicts: string[] }).conflicts, ['a.txt', 'docs']);
    assert.equal(await readFile(join(root, 'target', 'a.txt'), 'utf8'), 'old');
  });

  it('overwrites, skips, or keeps both', async () => {
    await writeFile(join(root, 'target', 'a.txt'), 'old');

    const skip = await settled(await service.start({ kind: 'copy', sources: ['a.txt'], destination: 'target', conflict: 'skip' }));
    assert.equal(skip.skipped, 1);
    assert.equal(await readFile(join(root, 'target', 'a.txt'), 'utf8'), 'old');

    await settled(await service.start({ kind: 'copy', sources: ['a.txt'], destination: 'target', conflict: 'rename' }));
    await settled(await service.start({ kind: 'copy', sources: ['a.txt'], destination: 'target', conflict: 'rename' }));
    assert.deepEqual((await readdir(join(root, 'target'))).sort(), ['a copy 2.txt', 'a copy.txt', 'a.txt']);

    await settled(await service.start({ kind: 'copy', sources: ['a.txt'], destination: 'target', conflict: 'overwrite' }));
    assert.equal(await readFile(join(root, 'target', 'a.txt'), 'utf8'), 'alpha');
  });

  it('duplicates in place as a copy, never onto itself', async () => {
    const job = await settled(await service.start({ kind: 'copy', sources: ['a.txt'], destination: '', conflict: 'fail' }));

    assert.equal(job.state, 'done');
    assert.equal(await readFile(join(root, 'a copy.txt'), 'utf8'), 'alpha');
  });

  it('refuses a folder into itself', async () => {
    const error = await refused(service.start({ kind: 'copy', sources: ['docs'], destination: 'docs/deep', conflict: 'fail' }));

    assert.equal(error.status, 400);
    assert.match(error.message, /into itself/);
  });

  it('copies a link as a link', async () => {
    await symlink('a.txt', join(root, 'link'));

    await settled(await service.start({ kind: 'copy', sources: ['link'], destination: 'target', conflict: 'fail' }));

    assert.ok((await lstat(join(root, 'target', 'link'))).isSymbolicLink());
    assert.equal(await readlink(join(root, 'target', 'link')), 'a.txt');
  });

  it('refuses paths out of the root, and a missing source', async () => {
    assert.equal((await refused(service.start({ kind: 'copy', sources: ['../x'], destination: '', conflict: 'fail' }))).status, 403);
    assert.equal((await refused(service.start({ kind: 'copy', sources: ['nope'], destination: 'target', conflict: 'fail' }))).status, 404);
    assert.equal((await refused(service.start({ kind: 'copy', sources: ['a.txt'], destination: 'a.txt', conflict: 'fail' }))).status, 400);
  });

  it('stops when cancelled, leaving no half-written file', async () => {
    await writeFile(join(root, 'big.bin'), Buffer.alloc(64 * 1024 * 1024));

    const started = await service.start({ kind: 'copy', sources: ['big.bin'], destination: 'target', conflict: 'fail' });
    service.cancel(started.id);
    const job = await settled(started);

    assert.equal(job.state, 'cancelled');
    assert.deepEqual(await readdir(join(root, 'target')), []);
  });
});

describe('move', () => {
  it('moves entries, and names both folders as affected', async () => {
    const job = await settled(
      await service.start({ kind: 'move', sources: ['docs/b.md', 'a.txt'], destination: 'target', conflict: 'fail' }),
    );

    assert.equal(job.state, 'done');
    assert.deepEqual((await readdir(join(root, 'target'))).sort(), ['a.txt', 'b.md']);
    assert.deepEqual(await readdir(join(root, 'docs')), ['deep']);
    assert.deepEqual([...job.affected].sort(), ['', 'docs', 'target']);
  });

  it('does nothing for an entry moved to where it already is', async () => {
    const job = await settled(await service.start({ kind: 'move', sources: ['a.txt'], destination: '', conflict: 'fail' }));

    assert.equal(job.state, 'done');
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha');
  });
});

describe('trash', () => {
  it('moves entries into the server trash, recording where they were', async () => {
    const job = await settled(await service.start({ kind: 'trash', paths: ['a.txt', 'docs'] }));

    assert.equal(job.state, 'done');
    assert.equal(job.doneItems, 2);
    assert.deepEqual([...job.affected], ['']);
    const trashed = await readdir(join(root, SERVER_TRASH_DIR, 'files'));
    assert.equal(trashed.length, 2);
    const info = await readdir(join(root, SERVER_TRASH_DIR, 'info'));
    const records = await Promise.all(
      info.map(async (name) => JSON.parse(await readFile(join(root, SERVER_TRASH_DIR, 'info', name), 'utf8')) as { path: string }),
    );
    assert.deepEqual(records.map((record) => record.path).sort(), ['a.txt', 'docs']);
  });

  it('keeps the trash out of reach', async () => {
    await settled(await service.start({ kind: 'trash', paths: ['a.txt'] }));

    assert.equal((await refused(service.start({ kind: 'trash', paths: [SERVER_TRASH_DIR] }))).status, 403);
    assert.equal(
      (await refused(service.start({ kind: 'copy', sources: ['docs'], destination: SERVER_TRASH_DIR, conflict: 'fail' }))).status,
      403,
    );
    assert.equal((await refused(service.start({ kind: 'trash', paths: [''] }))).status, 400);
  });

  it('empties the trash for good', async () => {
    await settled(await service.start({ kind: 'trash', paths: ['a.txt', 'docs'] }));

    const job = await settled(await service.start({ kind: 'empty-trash' }));

    assert.equal(job.state, 'done');
    assert.equal(job.totalItems, 2);
    assert.deepEqual(await readdir(join(root, SERVER_TRASH_DIR, 'files')), []);
    assert.deepEqual(await readdir(join(root, SERVER_TRASH_DIR, 'info')), []);
  });

  it('empties a trash nothing was ever thrown into', async () => {
    const job = await settled(await service.start({ kind: 'empty-trash' }));

    assert.equal(job.state, 'done');
    assert.equal(job.totalItems, 0);
  });

  it('hands trashing to a system trash when there is one', async () => {
    const seen: string[] = [];
    await fresh(() => ({
      kind: 'system',
      affected: [],
      contains: () => false,
      trash: async (_absolute, relative) => {
        seen.push(relative);
        return null;
      },
      empty: async (progress) => progress(1, null),
    }));

    const job = await settled(await service.start({ kind: 'trash', paths: ['docs/b.md'] }));

    assert.equal(job.state, 'done');
    assert.deepEqual(seen, ['docs/b.md']);
    assert.deepEqual(job.outcome, [], 'no id, so nothing to restore by');
    assert.deepEqual(service.info, { trash: 'system', canRestore: false });
    assert.equal((await refused(service.start({ kind: 'restore', ids: ['x'] }))).status, 400);
  });

  it('reports a failure as the job’s end, not a throw', async () => {
    await fresh(() => ({
      kind: 'system',
      affected: [],
      contains: () => false,
      trash: async () => {
        throw Object.assign(new Error('nope'), { code: 'EACCES' });
      },
      empty: async () => undefined,
    }));

    const job = await settled(await service.start({ kind: 'trash', paths: ['a.txt'] }));

    assert.equal(job.state, 'failed');
    assert.equal(job.error?.code, 'FORBIDDEN');
  });
});

describe('jobs', () => {
  it('answers 404 for a job it never had', () => {
    assert.throws(() => service.status('nope'), (error: unknown) => error instanceof HttpError && error.status === 404);
  });

  it('leaves a finished job as it ended when cancelled late', async () => {
    const job = await settled(await service.start({ kind: 'trash', paths: ['a.txt'] }));

    assert.equal(service.cancel(job.id).state, 'done');
  });
});

describe('outcome (PRD 003, §5)', () => {
  it('pairs each copied entry with its copy, leaving out what was skipped', async () => {
    await writeFile(join(root, 'target', 'a.txt'), 'old');

    const kept = await settled(
      await service.start({ kind: 'copy', sources: ['a.txt', 'docs'], destination: 'target', conflict: 'rename' }),
    );
    assert.deepEqual(kept.outcome, [
      { source: 'a.txt', target: 'target/a copy.txt' },
      { source: 'docs', target: 'target/docs' },
    ]);

    const skipped = await settled(
      await service.start({ kind: 'copy', sources: ['a.txt'], destination: 'target', conflict: 'skip' }),
    );
    assert.deepEqual(skipped.outcome, []);
  });

  it('pairs each moved entry with where it is now', async () => {
    const job = await settled(
      await service.start({ kind: 'move', sources: ['docs/b.md', 'a.txt'], destination: 'target', conflict: 'fail' }),
    );

    assert.deepEqual(job.outcome, [
      { source: 'docs/b.md', target: 'target/b.md' },
      { source: 'a.txt', target: 'target/a.txt' },
    ]);
  });

  it('starts every job with an empty outcome', async () => {
    const job = await service.start({ kind: 'empty-trash' });
    assert.deepEqual(job.outcome, []);
  });
});

describe('delete (PRD 003, §5)', () => {
  it('removes entries for good, a folder with everything in it', async () => {
    const job = await settled(await service.start({ kind: 'delete', paths: ['a.txt', 'docs'] }));

    assert.equal(job.state, 'done');
    assert.equal(job.kind, 'delete');
    assert.equal(job.totalItems, 2);
    assert.equal(job.doneItems, 2);
    assert.deepEqual(job.affected, ['']);
    assert.deepEqual(job.outcome, []);
    assert.deepEqual((await readdir(root)).sort(), ['target']);
    await assert.rejects(readdir(join(root, SERVER_TRASH_DIR, 'files')), 'nothing went to the trash');
  });

  it('removes a link, never what it leads to', async () => {
    await symlink('docs', join(root, 'link'));

    await settled(await service.start({ kind: 'delete', paths: ['link'] }));

    assert.deepEqual((await readdir(join(root, 'docs'))).sort(), ['b.md', 'deep']);
    await assert.rejects(lstat(join(root, 'link')));
  });

  it('refuses the root, the trash and what is not there, before anything is deleted', async () => {
    assert.equal((await refused(service.start({ kind: 'delete', paths: [''] }))).status, 400);
    assert.equal((await refused(service.start({ kind: 'delete', paths: [SERVER_TRASH_DIR] }))).status, 403);
    assert.equal((await refused(service.start({ kind: 'delete', paths: ['a.txt', 'nope'] }))).status, 404);
    assert.equal((await refused(service.start({ kind: 'delete', paths: [] }))).status, 400);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha');
  });
});

describe('restore (PRD 003, §5)', () => {
  async function trashed(...paths: string[]): Promise<string[]> {
    const job = await settled(await service.start({ kind: 'trash', paths }));
    assert.equal(job.state, 'done');
    assert.deepEqual(
      job.outcome.map((pair) => pair.source),
      paths,
    );
    return job.outcome.map((pair) => pair.target);
  }

  it('says it can restore from the server trash', () => {
    assert.deepEqual(service.info, { trash: 'server', canRestore: true });
  });

  it('puts trashed entries back where they were, by the ids the trash job gave', async () => {
    const ids = await trashed('a.txt', 'docs/deep');

    const job = await settled(await service.start({ kind: 'restore', ids }));

    assert.equal(job.state, 'done');
    assert.equal(job.kind, 'restore');
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha');
    assert.equal((await readFile(join(root, 'docs', 'deep', 'c.bin'))).length, 4096);
    assert.deepEqual(job.outcome, [
      { source: ids[0], target: 'a.txt' },
      { source: ids[1], target: 'docs/deep' },
    ]);
    assert.deepEqual([...job.affected].sort(), ['', 'docs']);
    assert.deepEqual(await readdir(join(root, SERVER_TRASH_DIR, 'files')), []);
    assert.deepEqual(await readdir(join(root, SERVER_TRASH_DIR, 'info')), []);
  });

  it('keeps both when the name has been taken since', async () => {
    const [id] = await trashed('a.txt');
    await writeFile(join(root, 'a.txt'), 'newer');

    const job = await settled(await service.start({ kind: 'restore', ids: [id as string] }));

    assert.deepEqual(job.outcome, [{ source: id, target: 'a copy.txt' }]);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'newer');
    assert.equal(await readFile(join(root, 'a copy.txt'), 'utf8'), 'alpha');
  });

  it('makes the folder again when it has gone', async () => {
    const [id] = await trashed('docs/deep/c.bin');
    await rm(join(root, 'docs'), { recursive: true });

    const job = await settled(await service.start({ kind: 'restore', ids: [id as string] }));

    assert.equal(job.state, 'done');
    assert.equal((await readFile(join(root, 'docs', 'deep', 'c.bin'))).length, 4096);
  });

  it('answers 404 for an id the trash does not have, and never reads outside it', async () => {
    const [id] = await trashed('a.txt');

    assert.equal((await refused(service.start({ kind: 'restore', ids: [id as string, 'nope'] }))).status, 404);
    assert.equal((await refused(service.start({ kind: 'restore', ids: ['../info'] }))).status, 404);
    assert.equal((await refused(service.start({ kind: 'restore', ids: ['..'] }))).status, 404);
    assert.equal((await refused(service.start({ kind: 'restore', ids: [] }))).status, 400);
    await assert.rejects(readFile(join(root, 'a.txt')), 'nothing was restored');
  });
});
