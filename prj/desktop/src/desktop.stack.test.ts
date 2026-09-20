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
  staticRoot = join(workspace, 'browser');
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

  it('serves the file-system API from the same origin', async () => {
    const response = await fetch(`${base}/api/fs/list?path=`);
    const body = (await response.json()) as { data: { entries: { name: string }[] } };

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.data.entries.map((entry) => entry.name).sort(),
      ['README.md', 'docs'],
    );
  });

  it('confines the API to the configured files root', async () => {
    const response = await fetch(`${base}/api/fs/list?path=${encodeURIComponent('../..')}`);

    // The backend's own confinement rule, reached through the desktop shell.
    assert.equal(response.status, 403);
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
  it('browses the home directory when nothing names a root', () => {
    const config = DesktopConfig.resolve(environment({ TR_FILE_STATIC_ROOT: staticRoot }));

    assert.equal(config.filesRoot, filesRoot);
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
});
