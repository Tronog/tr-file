import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '@tr-file/backend/app';
import type { FsBridgeResponse } from '@tr-file/backend/bridge';
import { AppConfig } from '@tr-file/backend/config';
import { Logger } from '@tr-file/backend/core';

import { BridgeSessions, type WindowRef } from './bridge-sessions.js';

/**
 * PRD 006, §1 — each window's commands go to the local backend, or to the
 * remote server it connected to. Two real backends: this process's own, and
 * a "remote" one on a socket, each over a folder with different files.
 */

const SILENT = Logger.create('error');

let localRoot: string;
let remoteRoot: string;
let server: Server;
let port: number;
let sessions: BridgeSessions;

/** A window, as far as the router can tell: an id, and an event when it closes. */
class FakeWindow extends EventEmitter {
  private static next = 1;
  readonly id = FakeWindow.next++;
}

const window = (): WindowRef & FakeWindow => new FakeWindow() as WindowRef & FakeWindow;

function dataOf<T>(response: FsBridgeResponse): T {
  assert.ok('data' in response, `expected data, got ${JSON.stringify(response)}`);
  return response.data as T;
}

const names = async (sender: WindowRef): Promise<string[]> =>
  dataOf<{ entries: { name: string }[] }>(await sessions.dispatch(sender, { command: 'list', path: '' })).entries
    .map((entry) => entry.name)
    .sort();

const connectTo = (sender: WindowRef, overrides: Record<string, unknown> = {}) =>
  sessions.dispatch(sender, {
    command: 'connect',
    scheme: 'http',
    host: '127.0.0.1',
    port,
    user: 'ana',
    password: 'secret',
    ...overrides,
  });

before(async () => {
  localRoot = await mkdtemp(join(tmpdir(), 'tr-file-local-'));
  remoteRoot = await mkdtemp(join(tmpdir(), 'tr-file-far-'));
  await writeFile(join(localRoot, 'here.txt'), 'local');
  await writeFile(join(remoteRoot, 'there.txt'), 'remote');

  const local = new App(AppConfig.fromEnv({ FILES_ROOT: localRoot, AUTH_ENABLED: 'false' }), SILENT, 'local');
  const remote = new App(
    AppConfig.fromEnv({ FILES_ROOT: remoteRoot, AUTH_USERNAME: 'ana', AUTH_PASSWORD: 'secret' }),
    SILENT,
    'remote',
  );
  server = remote.instance.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  port = (server.address() as { port: number }).port;
  sessions = new BridgeSessions(local.bridge, SILENT);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(localRoot, { recursive: true, force: true });
  await rm(remoteRoot, { recursive: true, force: true });
});

describe('BridgeSessions', () => {
  it('sends a window’s commands to the local backend to begin with', async () => {
    const sender = window();

    assert.deepEqual(await names(sender), ['here.txt']);
    assert.deepEqual(dataOf(await sessions.dispatch(sender, { command: 'connection-status' })), { connected: false });
  });

  it('sends them to the remote server once the window connects, and back once it disconnects', async () => {
    const sender = window();

    const info = dataOf(await connectTo(sender));
    assert.deepEqual(info, { connected: true, scheme: 'http', host: '127.0.0.1', port, user: 'ana' });
    assert.deepEqual(await names(sender), ['there.txt']);
    assert.deepEqual(dataOf(await sessions.dispatch(sender, { command: 'connection-status' })), info);

    dataOf(await sessions.dispatch(sender, { command: 'disconnect' }));
    assert.deepEqual(await names(sender), ['here.txt']);
  });

  it('keeps each window on its own backend', async () => {
    const far = window();
    const near = window();

    dataOf(await connectTo(far));

    assert.deepEqual(await names(far), ['there.txt']);
    assert.deepEqual(await names(near), ['here.txt']);
  });

  it('leaves a window where it was when connecting fails', async () => {
    const sender = window();

    const refused = await connectTo(sender, { password: 'wrong' });
    assert.ok('error' in refused && refused.error.code === 'UNAUTHORIZED');
    assert.deepEqual(await names(sender), ['here.txt']);
  });

  it('refuses an address that is not one, before trying to reach it', async () => {
    const sender = window();
    for (const overrides of [
      { host: 'evil.example/api?x=' },
      { host: 'a@b' },
      { port: 70000 },
      { port: '22' },
      { scheme: 'file' },
    ]) {
      const refused = await connectTo(sender, overrides);
      assert.ok('error' in refused && refused.error.code === 'BAD_REQUEST', JSON.stringify(overrides));
    }
  });

  it('asks the window’s own backend whether it is signed in', async () => {
    const sender = window();
    assert.equal(await sessions.authenticated(sender), true);

    dataOf(await connectTo(sender, { user: null, password: null }));
    assert.equal(await sessions.authenticated(sender), false);
  });

  it('saves a copy from whichever backend the window is on', async () => {
    const sender = window();
    dataOf(await connectTo(sender));
    const destination = join(localRoot, 'copied.txt');

    dataOf(await sessions.saveCopy(sender, 'there.txt', destination, {}));

    assert.equal(await readFile(destination, 'utf8'), 'remote');
  });

  it('forgets a window’s connection when the window closes', async () => {
    const sender = window();
    dataOf(await connectTo(sender));

    sender.emit('destroyed');

    assert.equal(sessions.remoteFor(sender), null);
  });
});
