import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import { FilePathResolver } from '../files/index.js';
import { DISK_USAGE_LIMITS, DISK_USAGE_MAX_DEPTH, type DiskUsageNodeDto, type DiskUsageScanDto } from './disk-usage.model.js';
import { DiskUsageService } from './disk-usage.service.js';

/** PRD 013, §1 — disk usage, worked out on the backend and asked how far it has got. */

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-disk-usage-'));
  await mkdir(join(root, 'docs', 'deep'), { recursive: true });
  await writeFile(join(root, 'docs', 'a.txt'), 'x'.repeat(100));
  await writeFile(join(root, 'docs', 'deep', 'b.bin'), 'y'.repeat(1000));
  await writeFile(join(root, 'top.txt'), 'z'.repeat(10));
  // One file, two names: its room counted once.
  await link(join(root, 'docs', 'deep', 'b.bin'), join(root, 'docs', 'deep', 'again.bin'));
  // A link is itself, never what it leads to.
  await symlink(join(root, 'docs'), join(root, 'to-docs'));
  await mkdir(join(root, 'many'));
  for (let index = 0; index < DISK_USAGE_LIMITS.childrenPerFolder + 5; index += 1) {
    await writeFile(join(root, 'many', `f${String(index).padStart(3, '0')}`), 'n'.repeat(index + 1));
  }
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const service = () => new DiskUsageService(new FilePathResolver(root, ['.tr-file-trash']), Logger.create('error'));

async function done(du: DiskUsageService, scan: DiskUsageScanDto, path?: string, depth = 1): Promise<DiskUsageScanDto> {
  for (;;) {
    const status = du.status(scan.id, { ...(path === undefined ? {} : { path }), depth });
    if (status.state !== 'running') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const child = (node: DiskUsageNodeDto | null | undefined, name: string) => node?.children?.find((entry) => entry.name === name);

describe('DiskUsageService', () => {
  it('adds up what is under a folder, largest first, each folder done once all of it is in', async () => {
    const du = service();
    const scan = await du.start('docs');
    assert.equal(scan.state, 'running');
    assert.equal(scan.maxDepth, DISK_USAGE_MAX_DEPTH);
    const status = await done(du, scan, 'docs', 2);

    assert.equal(status.state, 'done');
    assert.deepEqual(status.totals, { size: 1100, onDisk: status.totals.onDisk, files: 3, folders: 1, errors: 0, skipped: 0 });
    const tree = status.report?.tree;
    assert.equal(tree?.state, 'done');
    assert.deepEqual(
      tree?.children?.map((entry) => [entry.kind, entry.name, entry.size]),
      [
        ['folder', 'deep', 1000],
        ['file', 'a.txt', 100],
      ],
    );
    // Two names for one file: the second takes no room.
    const deep = child(tree, 'deep');
    assert.equal((child(deep, 'b.bin')?.size ?? 0) + (child(deep, 'again.bin')?.size ?? 0), 1000);
    assert.equal(child(tree, 'deep')?.files, 2);
    assert.equal(child(tree, 'deep')?.path, 'docs/deep');
  });

  it('reports any folder of a scan, to the depth asked, and refuses one outside it', async () => {
    const du = service();
    const scan = await du.start('');
    const status = await done(du, scan, 'docs/deep', 1);
    assert.equal(status.report?.path, 'docs/deep');
    assert.equal(status.report?.tree?.size, 1000);
    // Depth 0: the folder alone.
    assert.equal(du.status(scan.id, { path: 'docs', depth: 0 }).report?.tree?.children, undefined);
    // A link counts as a file of its own, never as the folder it leads to.
    assert.equal(child(du.status(scan.id, { path: '', depth: 1 }).report?.tree, 'to-docs')?.kind, 'file');

    const inner = await du.start('docs');
    await done(du, inner);
    assert.throws(() => du.status(inner.id, { path: 'many' }), /not in the scan/);
  });

  it('lists the largest entries of a folder and sums the rest', async () => {
    const du = service();
    const status = await done(du, await du.start('many'));
    const children = status.report?.tree?.children ?? [];
    assert.equal(children.length, DISK_USAGE_LIMITS.childrenPerFolder + 1);
    assert.equal(children[0]?.name, `f${String(DISK_USAGE_LIMITS.childrenPerFolder + 4).padStart(3, '0')}`);
    const rest = children.at(-1);
    assert.equal(rest?.kind, 'rest');
    assert.equal(rest?.path, null);
    assert.equal(rest?.count, 5);
    // The five smallest: 1 + 2 + 3 + 4 + 5 bytes.
    assert.equal(rest?.size, 15);
    assert.equal(status.report?.tree?.size, ((DISK_USAGE_LIMITS.childrenPerFolder + 5) * (DISK_USAGE_LIMITS.childrenPerFolder + 6)) / 2);
  });

  it(`goes ${DISK_USAGE_MAX_DEPTH} levels deep and no further`, async () => {
    const nested = join(root, 'nested');
    let at = nested;
    for (let level = 0; level <= DISK_USAGE_MAX_DEPTH + 1; level += 1) {
      at = join(at, 'd');
    }
    await mkdir(at, { recursive: true });
    await writeFile(join(at, 'past.txt'), 'too deep');
    const du = service();
    const status = await done(du, await du.start('nested'));
    assert.equal(status.totals.skipped, 1);
    assert.equal(status.totals.files, 0);
    assert.equal(status.totals.folders, DISK_USAGE_MAX_DEPTH + 1);
    const deepest = ['nested', ...Array.from({ length: DISK_USAGE_MAX_DEPTH + 1 }, () => 'd')].join('/');
    assert.equal(du.status(status.id, { path: deepest, depth: 0 }).report?.tree?.state, 'too-deep');
  });

  it('stops a scan asked to', async () => {
    const du = service();
    const scan = await du.start('');
    du.cancel(scan.id);
    const status = await done(du, scan);
    assert.ok(status.state === 'cancelled' || status.state === 'done');
    assert.notEqual(status.finishedAt, null);
  });

  it('scans folders only, and only what is there', async () => {
    const du = service();
    await assert.rejects(du.start('top.txt'), /Only a folder/);
    await assert.rejects(du.start('missing'), /No such folder/);
    await assert.rejects(du.start('../elsewhere'), /escapes/);
    assert.throws(() => du.status('no-such-scan'), /No such disk usage scan/);
  });
});

describe('/api/disk-usage', () => {
  let server: Server;
  let base: string;
  let app: App;

  before(async () => {
    app = new App(AppConfig.fromEnv({ FILES_ROOT: root }), Logger.create('error'), '0.0.0-test');
    server = app.instance.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/disk-usage`;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('starts a scan, answers how far it has got and stops it', async () => {
    const started = await fetch(`${base}/scans`, {
      method: 'POST',
      body: JSON.stringify({ path: 'docs' }),
      headers: { 'Content-Type': 'application/json', 'X-TR-File-Request': '1' },
    });
    assert.equal(started.status, 202);
    const scan = ((await started.json()) as { data: DiskUsageScanDto }).data;
    assert.equal(scan.path, 'docs');

    let status: DiskUsageScanDto;
    do {
      status = ((await (await fetch(`${base}/scans/${scan.id}?path=docs&depth=2`)).json()) as { data: DiskUsageScanDto }).data;
    } while (status.state === 'running');
    assert.equal(status.report?.depth, 2);
    assert.equal(status.report?.tree?.size, 1100);

    const cancelled = await fetch(`${base}/scans/${scan.id}/cancel`, { method: 'POST', headers: { 'X-TR-File-Request': '1' } });
    assert.equal(cancelled.status, 200);
    assert.equal((await fetch(`${base}/scans/${scan.id}?depth=x`)).status, 400);
  });

  it('is the bridge\'s du-start, du-status and du-cancel', async () => {
    const started = (await app.bridge.dispatch({ command: 'du-start', path: 'docs/deep' })) as { data: DiskUsageScanDto };
    assert.equal(started.data.path, 'docs/deep');
    let status: { data: DiskUsageScanDto };
    for (;;) {
      status = (await app.bridge.dispatch({ command: 'du-status', scanId: started.data.id, depth: 1 })) as { data: DiskUsageScanDto };
      if (status.data.state !== 'running') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(status.data.report?.tree?.size, 1000);
    const cancelled = (await app.bridge.dispatch({ command: 'du-cancel', scanId: started.data.id })) as { data: DiskUsageScanDto };
    assert.equal(cancelled.data.id, started.data.id);
  });
});
