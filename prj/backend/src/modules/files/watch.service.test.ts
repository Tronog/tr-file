import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { HttpError, Logger } from '../../core/index.js';
import { FilePathResolver } from './file-path.resolver.js';
import { WATCH_MAX_PATHS, WatchService, type WatchServiceOptions } from './watch.service.js';

/** PRD 003, §5 — auto-refresh by polling: which of the folders on screen changed. */

const roots: string[] = [];

let root: string;
let watches: WatchService;

function fresh(options: WatchServiceOptions = {}): WatchService {
  watches.close();
  watches = new WatchService(new FilePathResolver(root, ['.tr-file-trash']), Logger.create('error'), options);
  return watches;
}

/** Polls until `path` is reported changed — as the frontend would, only faster. */
async function changedEventually(watchId: string, paths: string[], path: string): Promise<string> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const result = await watches.watch(watchId, paths);
    assert.equal(result.watchId, watchId);
    if (result.changed.includes(path)) {
      return result.watchId;
    }
    assert.ok(Date.now() < deadline, `${path} was never reported changed`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-watch-'));
  roots.push(root);
  await mkdir(join(root, 'docs'));
  await mkdir(join(root, 'other'));
  await writeFile(join(root, 'a.txt'), 'alpha');
  watches = new WatchService(new FilePathResolver(root, ['.tr-file-trash']), Logger.create('error'));
});

afterEach(() => {
  watches.close();
});

after(async () => {
  await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
});

describe('WatchService', () => {
  it('starts a session with nothing changed', async () => {
    const result = await watches.watch(null, ['', 'docs']);

    assert.equal(typeof result.watchId, 'string');
    assert.deepEqual(result.changed, []);
    assert.equal(watches.watchedFolders, 2);
  });

  it('reports a folder whose entries changed, once', async () => {
    const { watchId } = await watches.watch(null, ['docs', 'other']);

    await writeFile(join(root, 'docs', 'new.txt'), 'hi');

    await changedEventually(watchId, ['docs', 'other'], 'docs');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = await watches.watch(watchId, ['docs', 'other']);
    assert.deepEqual(after.changed, [], 'already reported');
  });

  it('answers in the form the paths were asked in', async () => {
    const { watchId } = await watches.watch(null, ['/docs']);

    await writeFile(join(root, 'docs', 'new.txt'), 'hi');

    await changedEventually(watchId, ['/docs'], '/docs');
  });

  it('reports a watched folder that was deleted', async () => {
    const { watchId } = await watches.watch(null, ['docs']);

    await rm(join(root, 'docs'), { recursive: true });

    await changedEventually(watchId, ['docs'], 'docs');
  });

  it('starts again, all changed, for an id it does not know', async () => {
    const result = await watches.watch('from-before-a-restart', ['docs', '', 'missing']);

    assert.notEqual(result.watchId, 'from-before-a-restart');
    assert.deepEqual(result.changed, ['docs', '', 'missing']);
    assert.equal(watches.watchedFolders, 2, 'a missing folder is not watched');
  });

  it('replaces what a session watches, and lets go of what nobody watches', async () => {
    const { watchId } = await watches.watch(null, ['docs', 'other']);
    const second = await watches.watch(null, ['other']);
    assert.equal(watches.watchedFolders, 2);

    await watches.watch(watchId, ['docs']);
    assert.equal(watches.watchedFolders, 2, 'other is still watched by the second session');

    await watches.watch(second.watchId, []);
    assert.equal(watches.watchedFolders, 1);
  });

  it('passes over what is not a folder in the root', async () => {
    const result = await watches.watch(null, ['a.txt', '../..', '.tr-file-trash', 'missing', 'docs']);

    assert.deepEqual(result.changed, []);
    assert.equal(watches.watchedFolders, 1);
  });

  it(`refuses more than ${WATCH_MAX_PATHS} folders`, async () => {
    const paths = Array.from({ length: WATCH_MAX_PATHS + 1 }, (_, index) => `f${index}`);

    await assert.rejects(watches.watch(null, paths), (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.deepEqual((await watches.watch(null, paths.slice(1))).changed, []);
  });

  it('compares a folder’s times when the system will not watch it', async () => {
    fresh({
      watch: (() => {
        throw Object.assign(new Error('no watchers left'), { code: 'ENOSPC' });
      }) as unknown as NonNullable<WatchServiceOptions['watch']>,
    });
    const { watchId } = await watches.watch(null, ['docs']);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await writeFile(join(root, 'docs', 'new.txt'), 'hi');

    await changedEventually(watchId, ['docs'], 'docs');
    assert.deepEqual((await watches.watch(watchId, ['docs'])).changed, []);
  });

  it('drops a session left idle, so its id starts again', async () => {
    fresh({ idleMs: 20 });
    const { watchId } = await watches.watch(null, ['docs']);

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(watches.watchedFolders, 0);
    const again = await watches.watch(watchId, ['docs']);
    assert.notEqual(again.watchId, watchId);
    assert.deepEqual(again.changed, ['docs']);
  });

  it('lets go of everything on close', async () => {
    await watches.watch(null, ['docs', 'other']);

    watches.close();

    assert.equal(watches.watchedFolders, 0);
    await assert.rejects(watches.watch(null, ['docs']));
  });
});
