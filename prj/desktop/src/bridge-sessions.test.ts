import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { App } from '@tr-file/backend/app';
import type { FsBridgeResponse } from '@tr-file/backend/bridge';
import { AppConfig } from '@tr-file/backend/config';
import { Logger } from '@tr-file/backend/core';

import { BridgeSessions, type WindowRef } from './bridge-sessions.js';
import type { DesktopShell } from './desktop-shell.js';

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
let local: App;

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

  local = new App(AppConfig.fromEnv({ FILES_ROOT: localRoot, AUTH_ENABLED: 'false' }), SILENT, 'local');
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

/** A shell that records what it was asked to do, and answers as it is told. */
class FakeShell implements DesktopShell {
  readonly opened: string[] = [];
  readonly revealed: string[] = [];
  readonly asked: string[] = [];
  openFailure = '';
  run = false;

  async openPath(path: string): Promise<string> {
    this.opened.push(path);
    return this.openFailure;
  }

  showItemInFolder(path: string): void {
    this.revealed.push(path);
  }

  async confirmRun(name: string): Promise<boolean> {
    this.asked.push(name);
    return this.run;
  }
}

describe('BridgeSessions shell commands (PRD 003, §5)', () => {
  let shell: FakeShell;
  let withShell: BridgeSessions;
  let tempRoot: string;

  const open = (sender: WindowRef, path: unknown) => withShell.dispatch(sender, { command: 'shell-open', path });
  const errorOf = (response: FsBridgeResponse) => {
    assert.ok('error' in response, `expected an error, got ${JSON.stringify(response)}`);
    return response.error;
  };
  const connectShell = (sender: WindowRef) =>
    withShell.dispatch(sender, { command: 'connect', scheme: 'http', host: '127.0.0.1', port, user: 'ana', password: 'secret' });

  before(async () => {
    tempRoot = join(await mkdtemp(join(tmpdir(), 'tr-file-open-test-')), 'tr-file-open');
    await mkdir(join(localRoot, 'folder'), { recursive: true });
    await mkdir(join(remoteRoot, 'far-folder'), { recursive: true });
    await writeFile(join(localRoot, 'tool'), '#!/bin/sh\n');
    await chmod(join(localRoot, 'tool'), 0o755);
    await writeFile(join(localRoot, 'setup.exe'), 'MZ');
    await writeFile(join(remoteRoot, 'installer.bat'), '@echo off');
  });

  after(async () => {
    await rm(join(tempRoot, '..'), { recursive: true, force: true });
  });

  beforeEach(() => {
    shell = new FakeShell();
    withShell = new BridgeSessions(local.bridge, SILENT, shell, { tempRoot, platform: 'linux' });
  });

  it('opens a file on this computer with its default app', async () => {
    assert.deepEqual(dataOf(await open(window(), 'here.txt')), { opened: true });
    assert.deepEqual(shell.opened, [join(localRoot, 'here.txt')]);
    assert.deepEqual(shell.asked, []);
  });

  it('opens a folder in the file manager', async () => {
    assert.deepEqual(dataOf(await open(window(), 'folder')), { opened: true });
    assert.deepEqual(shell.opened, [join(localRoot, 'folder')]);
  });

  it('asks before running a program, and does nothing unless told Run', async () => {
    assert.deepEqual(dataOf(await open(window(), 'tool')), { opened: false });
    assert.deepEqual(dataOf(await open(window(), 'setup.exe')), { opened: false });
    assert.deepEqual(shell.asked, ['tool', 'setup.exe']);
    assert.deepEqual(shell.opened, []);

    shell.run = true;
    assert.deepEqual(dataOf(await open(window(), 'tool')), { opened: true });
    assert.deepEqual(shell.opened, [join(localRoot, 'tool')]);
  });

  it('says why when the system cannot open it', async () => {
    shell.openFailure = 'No application is associated with this file';

    const failure = errorOf(await open(window(), 'here.txt'));

    assert.deepEqual([failure.code, failure.status, failure.message], ['OPEN_FAILED', 500, shell.openFailure]);
  });

  it('refuses what is not there, not in the root, or not a path', async () => {
    assert.equal(errorOf(await open(window(), 'missing.txt')).status, 404);
    assert.equal(errorOf(await open(window(), '../..')).status, 403);
    assert.equal(errorOf(await open(window(), 7)).code, 'BAD_REQUEST');
    assert.equal(errorOf(await withShell.dispatch(window(), { command: 'shell-reveal' })).code, 'BAD_REQUEST');
    assert.deepEqual(shell.opened, []);
  });

  it('shows an entry in the file manager', async () => {
    assert.deepEqual(dataOf(await withShell.dispatch(window(), { command: 'shell-reveal', path: 'here.txt' })), {
      revealed: true,
    });
    assert.deepEqual(shell.revealed, [join(localRoot, 'here.txt')]);
  });

  it('opens a remote file from a copy in a temp folder of its own', async () => {
    const sender = window();
    dataOf(await connectShell(sender));

    assert.deepEqual(dataOf(await open(sender, 'there.txt')), { opened: true });

    const [copy] = shell.opened;
    assert.ok(copy?.startsWith(tempRoot), `expected a copy under ${tempRoot}, got ${copy}`);
    assert.equal(copy?.endsWith('there.txt'), true);
    assert.equal(await readFile(copy as string, 'utf8'), 'remote');
  });

  it('asks before running a remote program, before copying it', async () => {
    const sender = window();
    dataOf(await connectShell(sender));

    assert.deepEqual(dataOf(await open(sender, 'installer.bat')), { opened: false });
    assert.deepEqual(shell.asked, ['installer.bat']);
    assert.deepEqual(shell.opened, []);
  });

  it('opens no remote folder, reveals nothing remote, and passes remote refusals through', async () => {
    const sender = window();
    dataOf(await connectShell(sender));

    const folder = errorOf(await open(sender, 'far-folder'));
    assert.deepEqual([folder.code, folder.status], ['NOT_SUPPORTED', 400]);
    assert.equal(folder.message, 'Only files on a remote server can be opened with an app on this computer.');

    const reveal = errorOf(await withShell.dispatch(sender, { command: 'shell-reveal', path: 'there.txt' }));
    assert.deepEqual([reveal.code, reveal.status], ['NOT_SUPPORTED', 400]);
    assert.equal(reveal.message, 'Show in Folder works for files on this computer only.');

    assert.equal(errorOf(await open(sender, 'nope.txt')).status, 404);
    assert.deepEqual(shell.opened, []);
  });

  it('removes the remote copies on clean-up', async () => {
    await withShell.cleanUp();

    await assert.rejects(stat(tempRoot));
  });

  it('answers without a shell rather than failing', async () => {
    assert.equal(errorOf(await sessions.dispatch(window(), { command: 'shell-open', path: 'here.txt' })).code, 'NOT_SUPPORTED');
  });
});

describe('BridgeSessions and the system clipboard (PRD 003, §6)', () => {
  const errorOf = (response: FsBridgeResponse) => {
    assert.ok('error' in response, `expected an error, got ${JSON.stringify(response)}`);
    return response.error;
  };
  class FakeClipboard {
    files: string[] = [];
    cut = false;
    async readFiles() {
      return { files: this.files, cut: this.cut };
    }
    async writeFiles(files: readonly string[], cut: boolean) {
      this.files = [...files];
      this.cut = cut;
    }
  }
  let clipboard: FakeClipboard;
  let withClipboard: BridgeSessions;

  beforeEach(() => {
    clipboard = new FakeClipboard();
    withClipboard = new BridgeSessions(local.bridge, SILENT, null, { clipboard });
  });

  it('puts entries of this computer on it as host paths', async () => {
    const sender = window();
    assert.deepEqual(
      dataOf(await withClipboard.dispatch(sender, { command: 'clipboard-write', paths: ['here.txt', 'gone.txt'], cut: true })),
      { written: true },
    );
    assert.deepEqual(clipboard.files, [join(localRoot, 'here.txt')]);
    assert.equal(clipboard.cut, true);
  });

  it('reads what the system copied as paths in the root, and counts the rest', async () => {
    clipboard.files = [join(localRoot, 'here.txt'), '/nowhere/else.txt', join(tmpdir(), 'x')];
    assert.deepEqual(dataOf(await withClipboard.dispatch(window(), { command: 'clipboard-read' })), {
      paths: ['here.txt'],
      cut: false,
      outside: 2,
    });
  });

  it('says where dropped host paths are in the root', async () => {
    assert.deepEqual(
      dataOf(await withClipboard.dispatch(window(), { command: 'local-paths', absolute: [join(localRoot, 'here.txt'), '/etc/hostname'] })),
      ['here.txt', null],
    );
    assert.equal(errorOf(await withClipboard.dispatch(window(), { command: 'local-paths', absolute: 'x' })).status, 400);
  });

  it('hands out host paths for a drag from this computer only', async () => {
    const sender = window();
    assert.deepEqual(await withClipboard.dragFiles(sender, ['here.txt', 42, 'gone.txt']), [join(localRoot, 'here.txt')]);
    dataOf(await withClipboard.dispatch(sender, { command: 'connect', scheme: 'http', host: '127.0.0.1', port, user: 'ana', password: 'secret' }));
    assert.deepEqual(await withClipboard.dragFiles(sender, ['there.txt']), []);
    clipboard.files = [join(localRoot, 'here.txt')];
    assert.deepEqual(dataOf(await withClipboard.dispatch(sender, { command: 'clipboard-read' })), { paths: [], cut: false, outside: 1 });
    assert.deepEqual(dataOf(await withClipboard.dispatch(sender, { command: 'local-paths', absolute: [join(localRoot, 'here.txt')] })), [null]);
  });
});
