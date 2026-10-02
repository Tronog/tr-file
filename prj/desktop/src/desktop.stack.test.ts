import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Logger } from '@tr-file/backend/core';

import { DesktopConfig } from './desktop.config.js';
import { DesktopStack } from './desktop.stack.js';

/** Only failures are worth printing while the suite runs. */
const SILENT = Logger.create('error');

/** Stands in for the Angular bundle; the stack only ever reads files from it. */
const INDEX_HTML = '<!doctype html><title>tr-file</title><app-root></app-root>';
const BUNDLE_JS = 'export const build = 1;\n';

let workspace: string;
let staticRoot: string;
let filesRoot: string;
let stack: DesktopStack;
let base: string;

/** A `DesktopEnvironment` with no Electron in sight, which is the point. */
function environment(env: NodeJS.ProcessEnv): Parameters<typeof DesktopConfig.resolve>[0] {
  return {
    env,
    homeDir: filesRoot,
    appPath: workspace,
    resourcesPath: join(workspace, 'resources'),
    packaged: false,
  };
}

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tr-file-desktop-'));
  // Under a dot-folder, as an AppImage mounts at `/tmp/.mount_…`.
  staticRoot = join(workspace, '.mount_test', 'browser');
  filesRoot = join(workspace, 'files');
  await mkdir(staticRoot, { recursive: true });
  await mkdir(join(filesRoot, 'docs'), { recursive: true });
  await writeFile(join(staticRoot, 'index.html'), INDEX_HTML);
  await writeFile(join(staticRoot, 'main-ABCD1234.js'), BUNDLE_JS);
  await writeFile(join(filesRoot, 'README.md'), '# hello\n');

  const config = DesktopConfig.resolve(
    environment({ TR_FILE_STATIC_ROOT: staticRoot, FILES_ROOT: filesRoot, TR_FILE_DEV: '0' }),
  );
  stack = new DesktopStack(config, SILENT);
  base = (await stack.start()).href.replace(/\/$/, '');
});

after(async () => {
  await stack.stop();
  await rm(workspace, { recursive: true, force: true });
});

describe('the desktop stack', () => {
  it('listens on loopback, on a port the OS chose', () => {
    const url = new URL(base);
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(Number.parseInt(url.port, 10) > 0);
  });

  it('serves the Angular bundle', async () => {
    const response = await fetch(`${base}/main-ABCD1234.js`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), BUNDLE_JS);
    // Fingerprinted, so it may be cached forever.
    assert.match(response.headers.get('cache-control') ?? '', /immutable/);
  });

  /**
   * PRD 003, §2: the window uses the bridge, so an HTTP API would only be a
   * way in for every other local program — or a page that found the port.
   */
  it('serves no file-system API over HTTP', async () => {
    const listing = await fetch(`${base}/api/fs/list?path=`);
    const body = (await listing.json()) as { error?: { code?: string } };
    assert.equal(listing.status, 404);
    assert.equal(body.error?.code, 'NOT_FOUND');

    const form = new FormData();
    form.append('file', new Blob(['x']), 'planted.txt');
    const upload = await fetch(`${base}/api/fs/upload?path=`, { method: 'POST', body: form });
    assert.equal(upload.status, 404);
  });

  it('still reaches the files through the bridge', async () => {
    const response = await stack.bridge.dispatch({ command: 'list', path: '' });

    assert.ok('data' in response);
  });

  /** A page on another name that resolves to 127.0.0.1 — DNS rebinding. */
  it('refuses a request addressed to any host but its own', async () => {
    const port = new URL(base).port;
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/main-ABCD1234.js', headers: { host: `attacker.example:${port}` } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });

    assert.equal(status, 421);
    assert.equal((await fetch(`${base.replace('127.0.0.1', 'localhost')}/main-ABCD1234.js`)).status, 200);
  });

  /** The Angular router owns these paths; the server must not claim them. */
  it('falls back to index.html for a deep link', async () => {
    const response = await fetch(`${base}/docs/prd`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), INDEX_HTML);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  /** An unknown API route is the backend's 404 to answer, in its own JSON. */
  it('lets the backend answer for an unknown API route', async () => {
    const response = await fetch(`${base}/api/nowhere`);
    const body = (await response.json()) as { error?: { code?: string } };

    assert.equal(response.status, 404);
    assert.ok(body.error?.code !== undefined);
  });

  /** The fallback answers reads only, or every typo would look like a success. */
  it('does not answer a write to a path that does not exist', async () => {
    const response = await fetch(`${base}/docs/prd`, { method: 'POST' });

    assert.equal(response.status, 404);
  });
});

describe('DesktopConfig', () => {
  /** PRD 003, §6: the whole file system — the home folder is where the window starts. */
  it('browses the whole file system when nothing names a root', () => {
    const config = DesktopConfig.resolve(environment({ TR_FILE_STATIC_ROOT: staticRoot }));

    assert.equal(config.filesRoot, '/');
    assert.equal(config.serverEnv()['FILES_ROOT'], '/');
  });

  /** PRD 003, §2: optional on the desktop, and off unless an account is named. */
  it('leaves signing in off unless an account is named', () => {
    const plain = DesktopConfig.resolve(environment({ TR_FILE_STATIC_ROOT: staticRoot, AUTH_USERNAME: 'ignored' }));
    assert.equal(plain.serverEnv()['AUTH_ENABLED'], 'false');
    assert.equal(plain.serverEnv()['GIT_ENABLED'], 'true');

    const locked = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: staticRoot, TR_FILE_AUTH_USERNAME: 'ana', TR_FILE_AUTH_PASSWORD: 'secret' }),
    );
    assert.equal(locked.serverEnv()['AUTH_ENABLED'], 'true');
    assert.equal(locked.serverEnv()['AUTH_USERNAME'], 'ana');
    assert.equal(locked.serverEnv()['AUTH_PASSWORD'], 'secret');
  });

  it('starts a production desktop without an account, since signing in is optional there', async () => {
    const config = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: staticRoot, FILES_ROOT: filesRoot, TR_FILE_DEV: '0' }),
    );
    const shipped = new DesktopStack(config, SILENT);
    try {
      await shipped.start();
      const status = await shipped.bridge.dispatch({ command: 'auth-status' });
      assert.ok('data' in status);
      assert.deepEqual(status.data, { required: false, authenticated: true, username: null });
    } finally {
      await shipped.stop();
    }
  });

  it('keeps the server on loopback whatever the shell says', () => {
    const config = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: staticRoot, HOST: '0.0.0.0', PORT: '3000' }),
    );

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.serverEnv()['HOST'], '127.0.0.1');
    // `PORT` belongs to the backend's own env; ours is `TR_FILE_PORT`.
    assert.equal(config.serverEnv()['PORT'], '0');
  });

  /** An inspector opening over the app on every start is a nuisance. */
  it('keeps the dev tools shut unless asked, even in a checkout', () => {
    const plain = DesktopConfig.resolve(environment({ TR_FILE_STATIC_ROOT: staticRoot }));
    assert.equal(plain.devTools, false);
    // Debug logging and an open inspector are different requests.
    assert.equal(plain.development, true);

    const debugging = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: staticRoot, TR_FILE_DEV: '1' }),
    );
    assert.equal(debugging.devTools, false);

    const asked = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: staticRoot, TR_FILE_DEVTOOLS: '1' }),
    );
    assert.equal(asked.devTools, true);
  });

  it('loads the Angular dev server when one is named, in development only', () => {
    const dev = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: staticRoot, TR_FILE_DEV_SERVER: 'http://localhost:4200' }),
    );
    assert.equal(dev.devServerUrl?.href, 'http://localhost:4200/');

    // A packaged app must not be talked into loading its UI from elsewhere.
    const shipped = DesktopConfig.resolve(
      environment({
        TR_FILE_STATIC_ROOT: staticRoot,
        TR_FILE_DEV: '0',
        TR_FILE_DEV_SERVER: 'http://localhost:4200',
      }),
    );
    assert.equal(shipped.devServerUrl, null);

    const plain = DesktopConfig.resolve(environment({ TR_FILE_STATIC_ROOT: staticRoot }));
    assert.equal(plain.devServerUrl, null);
  });

  it('rejects a dev server address that is not one', () => {
    assert.throws(
      () => DesktopConfig.resolve(environment({ TR_FILE_DEV_SERVER: 'localhost:4200' })),
      /TR_FILE_DEV_SERVER/,
    );
    assert.throws(
      () => DesktopConfig.resolve(environment({ TR_FILE_DEV_SERVER: 'file:///tmp/app' })),
      /TR_FILE_DEV_SERVER/,
    );
  });

  it('rejects a port that is not one', () => {
    assert.throws(() => DesktopConfig.resolve(environment({ TR_FILE_PORT: 'http' })), /TR_FILE_PORT/);
  });

  it('refuses to start without an Angular build', async () => {
    const config = DesktopConfig.resolve(
      environment({ TR_FILE_STATIC_ROOT: join(workspace, 'absent') }),
    );

    assert.equal(config.hasStaticRoot, false);
    await assert.rejects(() => new DesktopStack(config, SILENT).start(), /No Angular build/);
  });

  it('starts without a build when the dev server is serving the UI', async () => {
    const config = DesktopConfig.resolve(
      environment({
        TR_FILE_STATIC_ROOT: join(workspace, 'absent'),
        TR_FILE_DEV_SERVER: 'http://localhost:4200',
      }),
    );
    const dev = new DesktopStack(config, SILENT);

    try {
      const url = await dev.start();
      assert.equal(url.hostname, '127.0.0.1');
    } finally {
      await dev.stop();
    }
  });
});
