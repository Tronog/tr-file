import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import type { OperationJobDto } from './operation.model.js';
import { SERVER_TRASH_DIR } from './server-trash.js';

/** PRD 005, §1 — the operations over HTTP, as a remote client sees them. */

let root: string;
let server: Server;
let base: string;

function post(path: string, body: unknown = {}): Promise<Response> {
  return fetch(`${base}/ops${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-TR-File-Request': '1' },
  });
}

async function settled(job: OperationJobDto): Promise<OperationJobDto> {
  for (;;) {
    const body = (await (await fetch(`${base}/ops/jobs/${job.id}`)).json()) as { data: OperationJobDto };
    if (body.data.state !== 'running') {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-ops-routes-'));
  await mkdir(join(root, 'target'));
  await writeFile(join(root, 'a.txt'), 'alpha');
  server = new App(AppConfig.fromEnv({ FILES_ROOT: root }), Logger.create('error'), '0.0.0-test').instance.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('/api/ops', () => {
  it('says whose trash it keeps', async () => {
    assert.deepEqual(await (await fetch(`${base}/ops/info`)).json(), { data: { trash: 'server' } });
  });

  it('starts a copy with 202 and reports it to the end', async () => {
    const response = await post('/copy', { sources: ['a.txt'], destination: 'target' });
    assert.equal(response.status, 202);

    const job = await settled(((await response.json()) as { data: OperationJobDto }).data);

    assert.equal(job.state, 'done');
    assert.equal(await readFile(join(root, 'target', 'a.txt'), 'utf8'), 'alpha');
  });

  it('answers 409 with the clashes', async () => {
    const response = await post('/copy', { sources: ['a.txt'], destination: 'target', conflict: 'fail' });
    const body = (await response.json()) as { error: { code: string; details: { conflicts: string[] } } };

    assert.equal(response.status, 409);
    assert.deepEqual(body.error.details.conflicts, ['a.txt']);
  });

  it('refuses a malformed body', async () => {
    assert.equal((await post('/move', { sources: 'a.txt', destination: '' })).status, 400);
    assert.equal((await post('/copy', { sources: [], destination: '' })).status, 400);
    assert.equal((await post('/copy', { sources: ['a.txt'], destination: 'target', conflict: 'maybe' })).status, 400);
  });

  it('needs the CSRF header, as every write does', async () => {
    const response = await fetch(`${base}/ops/trash`, {
      method: 'POST',
      body: JSON.stringify({ paths: ['a.txt'] }),
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(response.status, 403);
  });

  it('trashes, hides the trash from listings and the files API, and empties it', async () => {
    const trashed = await settled(((await (await post('/trash', { paths: ['target/a.txt'] })).json()) as { data: OperationJobDto }).data);
    assert.equal(trashed.state, 'done');

    const listing = (await (await fetch(`${base}/fs/list`)).json()) as { data: { entries: { name: string }[] } };
    assert.deepEqual(listing.data.entries.map((entry) => entry.name).sort(), ['a.txt', 'target']);
    assert.equal((await fetch(`${base}/fs/list?path=${SERVER_TRASH_DIR}`)).status, 403);

    const emptied = await settled(((await (await post('/empty-trash')).json()) as { data: OperationJobDto }).data);
    assert.equal(emptied.state, 'done');
    assert.deepEqual(await readdir(join(root, SERVER_TRASH_DIR, 'files')), []);
  });

  it('cancels, and answers 404 for an unknown job', async () => {
    const started = ((await (await post('/trash', { paths: ['a.txt'] })).json()) as { data: OperationJobDto }).data;
    assert.equal((await post(`/jobs/${started.id}/cancel`)).status, 200);
    assert.notEqual((await settled(started)).state, 'running');

    assert.equal((await fetch(`${base}/ops/jobs/unknown`)).status, 404);
  });
});
