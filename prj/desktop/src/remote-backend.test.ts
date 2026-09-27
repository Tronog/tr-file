import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '@tr-file/backend/app';
import type { FsBridgeResponse } from '@tr-file/backend/bridge';
import { AppConfig } from '@tr-file/backend/config';
import { Logger } from '@tr-file/backend/core';

import { RemoteBackend, type RemoteEndpoint } from './remote-backend.js';

/**
 * PRD 006, §1 — the desktop speaking to a remote tr-file server over its REST
 * API. A real backend, on a real socket, with signing in on: what is under
 * test is the translation of every bridge command into HTTP and back.
 */

const SILENT = Logger.create('error');

let root: string;
let server: Server;
let port: number;

function endpoint(overrides: Partial<RemoteEndpoint> = {}): RemoteEndpoint {
  return { scheme: 'http', host: '127.0.0.1', port, user: 'ana', password: 'secret', ...overrides };
}

async function connected(overrides: Partial<RemoteEndpoint> = {}): Promise<RemoteBackend> {
  const remote = await RemoteBackend.connect(endpoint(overrides), SILENT);
  assert.ok(remote instanceof RemoteBackend, `expected a connection, got ${JSON.stringify(remote)}`);
  return remote;
}

function dataOf<T>(response: FsBridgeResponse): T {
  assert.ok('data' in response, `expected data, got ${JSON.stringify(response)}`);
  return response.data as T;
}

function errorOf(response: FsBridgeResponse): { code: string; status: number; message: string } {
  assert.ok('error' in response, `expected an error, got ${JSON.stringify(response)}`);
  return response.error;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-remote-'));
  await writeFile(join(root, 'README.md'), '# hello remote\n');
  await writeFile(join(root, 'empty.txt'), '');
  const app = new App(
    AppConfig.fromEnv({ FILES_ROOT: root, AUTH_USERNAME: 'ana', AUTH_PASSWORD: 'secret', UPLOAD_MAX_BYTES: '4096' }),
    SILENT,
    '0.0.0-test',
  );
  server = app.instance.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  port = (server.address() as { port: number }).port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('RemoteBackend.connect', () => {
  it('signs in with the credentials it is given', async () => {
    const remote = await connected();

    assert.deepEqual(remote.info, { connected: true, scheme: 'http', host: '127.0.0.1', port, user: 'ana' });
    assert.deepEqual(dataOf(await remote.dispatch({ command: 'auth-status' })), {
      required: true,
      authenticated: true,
      username: 'ana',
    });
  });

  it('refuses a wrong password with the server’s own answer', async () => {
    const failure = await RemoteBackend.connect(endpoint({ password: 'nope' }), SILENT);

    assert.ok(!(failure instanceof RemoteBackend));
    assert.equal(failure.error.code, 'UNAUTHORIZED');
    assert.equal(failure.error.status, 401);
  });

  /** A saved server keeps no password: the window's sign-in screen asks for it. */
  it('connects without credentials, signed out, and signs in later', async () => {
    const remote = await connected({ user: null, password: null });

    assert.equal(dataOf<{ authenticated: boolean }>(await remote.dispatch({ command: 'auth-status' })).authenticated, false);
    assert.equal(errorOf(await remote.dispatch({ command: 'list', path: '' })).code, 'UNAUTHORIZED');

    dataOf(await remote.dispatch({ command: 'login', username: 'ana', password: 'secret' }));
    assert.ok('data' in (await remote.dispatch({ command: 'list', path: '' })));

    dataOf(await remote.dispatch({ command: 'logout' }));
    assert.equal(errorOf(await remote.dispatch({ command: 'list', path: '' })).code, 'UNAUTHORIZED');
  });

  it('says so when nothing is listening', async () => {
    const failure = await RemoteBackend.connect(endpoint({ port: 1 }), SILENT);

    assert.ok(!(failure instanceof RemoteBackend));
    assert.equal(failure.error.code, 'NETWORK_ERROR');
    assert.match(failure.error.message, /Could not reach ana@127\.0\.0\.1:1/);
  });

  it('says so when what answers is not a tr-file server', async () => {
    const other = createServer((_req, res) => {
      res.writeHead(404).end('nope');
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => other.once('listening', resolve));
    const failure = await RemoteBackend.connect(
      endpoint({ port: (other.address() as { port: number }).port }),
      SILENT,
    );
    await new Promise((resolve) => other.close(resolve));

    assert.ok(!(failure instanceof RemoteBackend));
    assert.equal(failure.error.status, 404);
  });
});

describe('RemoteBackend commands', () => {
  let remote: RemoteBackend;

  before(async () => {
    remote = await connected();
  });

  it('lists and describes, as the local bridge does', async () => {
    const listing = dataOf<{ entries: { name: string }[] }>(await remote.dispatch({ command: 'list', path: '' }));
    assert.deepEqual(listing.entries.map((entry) => entry.name).sort(), ['README.md', 'empty.txt']);

    const details = dataOf<{ size: number }>(await remote.dispatch({ command: 'details', path: 'README.md' }));
    assert.equal(details.size, 15);
  });

  it('passes the server’s refusals through, code and status', async () => {
    const failure = errorOf(await remote.dispatch({ command: 'list', path: '../..' }));
    assert.equal(failure.code, 'FORBIDDEN');
    assert.equal(failure.status, 403);
  });

  it('validates commands exactly as the local bridge does', async () => {
    assert.equal(errorOf(await remote.dispatch({ command: 'destroy', path: '' })).code, 'BAD_REQUEST');
  });

  it('reads a chunk by range, with the size of the whole file', async () => {
    const chunk = dataOf<{ content: Uint8Array; size: number; offset: number; mimeType: string | null }>(
      await remote.dispatch({ command: 'read', path: 'README.md', offset: 2, length: 5 }),
    );

    assert.equal(Buffer.from(chunk.content).toString(), 'hello');
    assert.equal(chunk.size, 15);
    assert.equal(chunk.offset, 2);
    assert.equal(chunk.mimeType, 'text/markdown');
  });

  it('reads an empty file as an empty chunk', async () => {
    const chunk = dataOf<{ content: Uint8Array; size: number }>(await remote.dispatch({ command: 'read', path: 'empty.txt' }));

    assert.equal(chunk.content.byteLength, 0);
    assert.equal(chunk.size, 0);
  });

  it('refuses a file past maxBytes', async () => {
    assert.equal(
      errorOf(await remote.dispatch({ command: 'read', path: 'README.md', maxBytes: 4 })).code,
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('uploads in chunks as one streamed request', async () => {
    const begun = dataOf<{ uploadId: string }>(
      await remote.dispatch({ command: 'upload-begin', path: '', filename: 'sent.txt', overwrite: false }),
    );
    for (const part of ['hel', 'lo ', 'remote']) {
      dataOf(await remote.dispatch({ command: 'upload-chunk', uploadId: begun.uploadId, content: new TextEncoder().encode(part) }));
    }
    const details = dataOf<{ path: string; size: number }>(
      await remote.dispatch({ command: 'upload-commit', uploadId: begun.uploadId }),
    );

    assert.equal(details.path, 'sent.txt');
    assert.equal(await readFile(join(root, 'sent.txt'), 'utf8'), 'hello remote');
  });

  it('refuses a taken name at begin, before any bytes are sent', async () => {
    const failure = errorOf(await remote.dispatch({ command: 'upload-begin', path: '', filename: 'README.md', overwrite: false }));

    assert.equal(failure.code, 'CONFLICT');
  });

  it('passes the server’s size limit through, however it is split', async () => {
    const begun = dataOf<{ uploadId: string }>(
      await remote.dispatch({ command: 'upload-begin', path: '', filename: 'big.bin', overwrite: false }),
    );
    let failure: { code: string } | undefined;
    for (let chunk = 0; chunk < 4 && failure === undefined; chunk += 1) {
      const sent = await remote.dispatch({ command: 'upload-chunk', uploadId: begun.uploadId, content: new Uint8Array(2048) });
      failure = 'error' in sent ? sent.error : undefined;
    }
    failure ??= errorOf(await remote.dispatch({ command: 'upload-commit', uploadId: begun.uploadId }));

    assert.equal(failure.code, 'PAYLOAD_TOO_LARGE');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await readdir(root)).includes('big.bin'), false);
  });

  it('abandons an aborted upload, keeping nothing', async () => {
    const begun = dataOf<{ uploadId: string }>(
      await remote.dispatch({ command: 'upload-begin', path: '', filename: 'gone.txt', overwrite: false }),
    );
    dataOf(await remote.dispatch({ command: 'upload-chunk', uploadId: begun.uploadId, content: new Uint8Array([1, 2]) }));

    dataOf(await remote.dispatch({ command: 'upload-abort', uploadId: begun.uploadId }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal((await readdir(root)).some((name) => name.startsWith('gone.txt') || name.includes('gone.txt')), false);
  });

  it('saves a copy of a remote file to disk, streaming it', async () => {
    const destination = join(root, '..', `tr-file-remote-copy-${process.pid}.md`);
    const seen: number[] = [];

    const result = dataOf<{ bytes: number }>(
      await remote.saveCopy('README.md', destination, { onProgress: (loaded) => seen.push(loaded) }),
    );

    assert.equal(result.bytes, 15);
    assert.equal(await readFile(destination, 'utf8'), '# hello remote\n');
    assert.equal(seen.at(-1), 15);
    await rm(destination);
  });

  it('runs file operations on the server, polled by id (PRD 005, §1)', async () => {
    assert.deepEqual(dataOf(await remote.dispatch({ command: 'op-info' })), { trash: 'server', canRestore: true });
    const started = dataOf<{ id: string; state: string }>(
      await remote.dispatch({ command: 'op-copy', sources: ['README.md'], destination: '', conflict: 'rename' }),
    );

    let job = started;
    while (job.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 5));
      job = dataOf(await remote.dispatch({ command: 'op-status', jobId: started.id }));
    }

    assert.equal(job.state, 'done');
    assert.equal(await readFile(join(root, 'README copy.md'), 'utf8'), '# hello remote\n');
    assert.equal(errorOf(await remote.dispatch({ command: 'op-trash', paths: 'README.md' })).code, 'BAD_REQUEST');
    assert.equal(
      errorOf(await remote.dispatch({ command: 'op-copy', sources: ['nope'], destination: '', conflict: 'fail' })).status,
      404,
    );
    assert.equal(
      dataOf<{ state: string }>(await remote.dispatch({ command: 'op-cancel', jobId: started.id })).state,
      'done',
    );
    assert.equal(errorOf(await remote.dispatch({ command: 'op-status', jobId: 'nope' })).status, 404);
  });

  it('renames, makes folders and files, over /api/fs (PRD 003, §5)', async () => {
    const folder = dataOf<{ path: string; type: string }>(await remote.dispatch({ command: 'mkdir', path: '', name: 'made' }));
    assert.deepEqual([folder.path, folder.type], ['made', 'directory']);

    const file = dataOf<{ path: string }>(await remote.dispatch({ command: 'create-file', path: 'made', name: 'new.txt' }));
    assert.equal(file.path, 'made/new.txt');
    assert.equal(await readFile(join(root, 'made', 'new.txt'), 'utf8'), '');

    const renamed = dataOf<{ path: string }>(await remote.dispatch({ command: 'rename', path: 'made/new.txt', to: 'made/old.txt' }));
    assert.equal(renamed.path, 'made/old.txt');

    const taken = errorOf(await remote.dispatch({ command: 'create-file', path: 'made', name: 'old.txt' }));
    assert.deepEqual([taken.code, taken.status], ['CONFLICT', 409]);
    assert.equal(errorOf(await remote.dispatch({ command: 'rename', path: 'made/old.txt' })).code, 'BAD_REQUEST');
  });

  it('searches, passing the limit through', async () => {
    const found = dataOf<{ query: string; entries: { path: string }[]; truncated: boolean }>(
      await remote.dispatch({ command: 'search', path: '', query: 'old*' }),
    );
    assert.equal(found.query, 'old*');
    assert.deepEqual(found.entries.map((entry) => entry.path), ['made/old.txt']);

    const limited = dataOf<{ entries: unknown[]; truncated: boolean }>(
      await remote.dispatch({ command: 'search', path: '', query: '.', limit: 1 }),
    );
    assert.deepEqual([limited.entries.length, limited.truncated], [1, true]);
    assert.equal(errorOf(await remote.dispatch({ command: 'search', path: '', query: ' ' })).status, 400);
  });

  it('watches on the server, keeping its session id', async () => {
    const opened = dataOf<{ watchId: string; changed: string[] }>(
      await remote.dispatch({ command: 'watch', watchId: null, paths: ['made'] }),
    );
    assert.deepEqual(opened.changed, []);

    const again = dataOf<{ watchId: string; changed: string[] }>(
      await remote.dispatch({ command: 'watch', watchId: opened.watchId, paths: ['made'] }),
    );
    assert.equal(again.watchId, opened.watchId);

    const resync = dataOf<{ watchId: string; changed: string[] }>(
      await remote.dispatch({ command: 'watch', watchId: 'from-before', paths: ['made'] }),
    );
    assert.deepEqual(resync.changed, ['made']);
  });

  it('trashes, restores and deletes on the server, with the outcome', async () => {
    const settle = async (started: { id: string; state: string }) => {
      let job = started as { id: string; state: string; outcome: { source: string; target: string }[] };
      while (job.state === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        job = dataOf(await remote.dispatch({ command: 'op-status', jobId: started.id }));
      }
      return job;
    };

    const trashed = await settle(dataOf(await remote.dispatch({ command: 'op-trash', paths: ['made/old.txt'] })));
    const id = trashed.outcome[0]?.target as string;
    const restored = await settle(dataOf(await remote.dispatch({ command: 'op-restore', ids: [id] })));
    assert.deepEqual(restored.outcome, [{ source: id, target: 'made/old.txt' }]);

    const deleted = await settle(dataOf(await remote.dispatch({ command: 'op-delete', paths: ['made'] })));
    assert.equal(deleted.state, 'done');
    assert.equal((await readdir(root)).includes('made'), false);
    assert.equal(errorOf(await remote.dispatch({ command: 'op-restore', ids: ['nope'] })).status, 404);
  });
});

describe('RemoteBackend places and archives (PRD 003, §6)', () => {
  it('answers the server’s places: its root and nothing else', async () => {
    const remote = await connected();
    assert.deepEqual(dataOf(await remote.dispatch({ command: 'places' })), {
      home: '',
      places: [{ id: 'root', label: 'Files', kind: 'root', path: '' }],
    });
  });

  it('compresses on the server, lists the zip, and saves a zip of it here', async () => {
    const remote = await connected();
    let job = dataOf<{ id: string; state: string }>(
      await remote.dispatch({ command: 'op-compress', sources: ['README.md'], destination: '', name: 'readme.zip', conflict: 'fail' }),
    );
    while (job.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 5));
      job = dataOf(await remote.dispatch({ command: 'op-status', jobId: job.id }));
    }
    assert.equal(job.state, 'done');

    const listing = dataOf<{ entries: { name: string }[] }>(await remote.dispatch({ command: 'archive-list', path: 'readme.zip', inner: '' }));
    assert.deepEqual(listing.entries.map((entry) => entry.name), ['README.md']);

    const local = await mkdtemp(join(tmpdir(), 'tr-file-remote-zip-'));
    try {
      const saved = await remote.saveZip(['README.md', 'empty.txt'], join(local, 'both.zip'));
      assert.ok('data' in saved, JSON.stringify(saved));
      assert.equal((await readFile(join(local, 'both.zip'))).subarray(0, 2).toString(), 'PK');
    } finally {
      await rm(local, { recursive: true, force: true });
    }
  });
});
