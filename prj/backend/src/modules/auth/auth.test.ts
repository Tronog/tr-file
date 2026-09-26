import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { HttpError, Logger } from '../../core/index.js';
import type { FsBridgeResponse } from '../bridge/index.js';
import { AuthService } from './auth.service.js';
import { hashPassword, verifyPassword } from './password-hash.js';

/**
 * PRD 003, §2 — signing in, and cross-site request forgery. The HTTP half is
 * exercised through a real server, because the cookie and header rules *are*
 * the behaviour.
 */

const SILENT = Logger.create('error');
const CSRF = { 'X-TR-File-Request': '1' };

async function rejectsWith(run: () => Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof HttpError && error.status === status);
}

describe('password hashes', () => {
  it('verifies the password they were made from, and nothing else', async () => {
    const encoded = await hashPassword('correct horse');

    assert.match(encoded, /^scrypt:16384:8:1:/);
    assert.equal(await verifyPassword('correct horse', encoded), true);
    assert.equal(await verifyPassword('correct horse ', encoded), false);
  });

  it('salts every hash, so equal passwords do not look equal', async () => {
    assert.notEqual(await hashPassword('same'), await hashPassword('same'));
  });

  it('treats an unreadable hash as a mismatch rather than an error', async () => {
    assert.equal(await verifyPassword('x', 'md5:abc'), false);
    assert.equal(await verifyPassword('x', 'scrypt:1:1:1::'), false);
  });
});

describe('AppConfig auth', () => {
  const env = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ FILES_ROOT: tmpdir(), ...extra });

  it('requires an account when credentials are given', () => {
    const config = AppConfig.fromEnv(env({ AUTH_USERNAME: 'ana', AUTH_PASSWORD: 'secret' }));

    assert.deepEqual(config.auth, { username: 'ana', password: 'secret' });
  });

  it('prefers a password hash to a plain password', () => {
    const config = AppConfig.fromEnv(env({ AUTH_USERNAME: 'ana', AUTH_PASSWORD: 'x', AUTH_PASSWORD_HASH: 'scrypt:1:1:1:a:b' }));

    assert.deepEqual(config.auth, { username: 'ana', passwordHash: 'scrypt:1:1:1:a:b' });
  });

  /** A production server with no account is a mistake, not an open door. */
  it('refuses to start a production server without an account', () => {
    assert.throws(() => AppConfig.fromEnv(env({ NODE_ENV: 'production' })), /AUTH_USERNAME/);
  });

  it('refuses to require signing in without an account to sign in with', () => {
    assert.throws(() => AppConfig.fromEnv(env({ AUTH_ENABLED: 'true' })), /AUTH_USERNAME/);
  });

  it('runs open only when told to, or in development with nothing configured', () => {
    assert.equal(AppConfig.fromEnv(env({ NODE_ENV: 'production', AUTH_ENABLED: 'false' })).auth, null);
    assert.equal(AppConfig.fromEnv(env({ AUTH_ENABLED: 'false', AUTH_USERNAME: 'ana', AUTH_PASSWORD: 'x' })).auth, null);
    assert.equal(AppConfig.fromEnv(env({ NODE_ENV: 'development' })).auth, null);
  });

  it('rejects an AUTH_ENABLED that is not a yes or a no', () => {
    assert.throws(() => AppConfig.fromEnv(env({ AUTH_ENABLED: 'maybe' })), /AUTH_ENABLED/);
  });
});

describe('AuthService', () => {
  let clock: number;
  const make = (): AuthService =>
    new AuthService({ username: 'ana', password: 'secret' }, 60_000, SILENT, () => clock);

  before(() => {
    clock = 1_000_000;
  });

  it('opens a session for the right account, and says who it belongs to', async () => {
    const auth = make();
    const token = await auth.signIn('ana', 'secret', 'client');

    assert.equal(auth.resolve(token), 'ana');
    assert.deepEqual(auth.status(token), { required: true, authenticated: true, username: 'ana' });
    assert.deepEqual(auth.status(undefined), { required: true, authenticated: false, username: null });
  });

  it('refuses a wrong password and a wrong username alike', async () => {
    const auth = make();

    await rejectsWith(() => auth.signIn('ana', 'wrong', 'client'), 401);
    await rejectsWith(() => auth.signIn('bob', 'secret', 'client'), 401);
  });

  it('makes a client that keeps guessing wait, even for the right password', async () => {
    const auth = make();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rejectsWith(() => auth.signIn('ana', 'wrong', 'guesser'), 401);
    }

    await rejectsWith(() => auth.signIn('ana', 'secret', 'guesser'), 429);
    // Someone else is not held up by it.
    assert.ok(await auth.signIn('ana', 'secret', 'someone-else'));

    clock += 15 * 60 * 1000;
    assert.ok(await auth.signIn('ana', 'secret', 'guesser'));
  });

  it('ends a session nobody has used for the idle time, and keeps a used one', async () => {
    const auth = make();
    const token = await auth.signIn('ana', 'secret', 'client');

    clock += 50_000;
    assert.equal(auth.resolve(token), 'ana');
    clock += 50_000;
    assert.equal(auth.resolve(token), 'ana');
    clock += 60_001;
    assert.equal(auth.resolve(token), null);
  });

  it('ends a session on sign-out', async () => {
    const auth = make();
    const token = await auth.signIn('ana', 'secret', 'client');

    auth.signOut(token);

    assert.equal(auth.resolve(token), null);
  });

  it('refuses a configured hash it cannot read, at start-up', () => {
    assert.throws(() => new AuthService({ username: 'ana', passwordHash: 'plain-text' }, 1, SILENT), /AUTH_PASSWORD_HASH/);
  });

  it('asks nobody to sign in when switched off', () => {
    const auth = new AuthService(null, 1, SILENT);

    assert.equal(auth.required, false);
    assert.deepEqual(auth.status(undefined), { required: false, authenticated: true, username: null });
  });
});

describe('the API with signing in on', () => {
  let root: string;
  let server: Server;
  let base: string;
  let app: App;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'tr-file-auth-'));
    await writeFile(join(root, 'README.md'), '# hello\n');
    app = new App(
      AppConfig.fromEnv({ FILES_ROOT: root, AUTH_USERNAME: 'ana', AUTH_PASSWORD: 'secret' }),
      SILENT,
      '0.0.0-test',
    );
    server = app.instance.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    base = `http://127.0.0.1:${address.port}/api`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const login = (password: string, headers: Record<string, string> = CSRF): Promise<Response> =>
    fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ username: 'ana', password }),
    });

  const cookieOf = (response: Response): string => (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  it('turns away the file system without a session', async () => {
    const response = await fetch(`${base}/fs/list?path=`);
    const body = (await response.json()) as { error: { code: string } };

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('says a session is needed, to anyone who asks', async () => {
    const response = await fetch(`${base}/auth/session`);

    assert.deepEqual(((await response.json()) as { data: unknown }).data, {
      required: true,
      authenticated: false,
      username: null,
    });
  });

  it('keeps the health check public', async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  it('refuses a wrong password', async () => {
    const response = await login('wrong');

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  it('signs in with a cookie no script can read and no other site sends', async () => {
    const response = await login('secret');
    const cookie = response.headers.get('set-cookie') ?? '';

    assert.equal(response.status, 200);
    assert.match(cookie, /^tr_file_session=[\w-]{40,};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
  });

  it('serves the file system to a signed-in session, until it signs out', async () => {
    const cookie = cookieOf(await login('secret'));

    const listed = await fetch(`${base}/fs/list?path=`, { headers: { cookie } });
    assert.equal(listed.status, 200);

    const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, ...CSRF } });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);

    assert.equal((await fetch(`${base}/fs/list?path=`, { headers: { cookie } })).status, 401);
  });

  it('protects the bridge with the same account', async () => {
    const session = { username: null };
    const refused = await app.bridge.dispatch({ command: 'list', path: '' }, session);
    assert.ok('error' in refused && refused.error.code === 'UNAUTHORIZED');

    const wrong = await app.bridge.dispatch({ command: 'login', username: 'ana', password: 'nope' }, session);
    assert.ok('error' in wrong && wrong.error.status === 401);

    const signedIn = (await app.bridge.dispatch(
      { command: 'login', username: 'ana', password: 'secret' },
      session,
    )) as FsBridgeResponse<{ authenticated: boolean }>;
    assert.ok('data' in signedIn && signedIn.data.authenticated);
    assert.ok('data' in (await app.bridge.dispatch({ command: 'list', path: '' }, session)));

    await app.bridge.dispatch({ command: 'logout' }, session);
    assert.ok('error' in (await app.bridge.dispatch({ command: 'list', path: '' }, session)));
  });

  it('will not save a copy for a connection that has not signed in', async () => {
    const result = await app.bridge.saveCopy('README.md', join(root, 'copy.md'), {}, { username: null });

    assert.ok('error' in result && result.error.code === 'UNAUTHORIZED');
  });
});

describe('cross-site request forgery', () => {
  let root: string;
  let server: Server;
  let base: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'tr-file-csrf-'));
    // Signing in is off here, so what is under test is the CSRF check alone.
    const app = new App(AppConfig.fromEnv({ FILES_ROOT: root, AUTH_ENABLED: 'false' }), SILENT, '0.0.0-test');
    server = app.instance.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    base = `http://127.0.0.1:${address.port}/api`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const upload = (headers: Record<string, string>): Promise<Response> => {
    const form = new FormData();
    form.append('file', new Blob(['x']), 'planted.txt');
    return fetch(`${base}/fs/upload?path=`, { method: 'POST', body: form, headers });
  };

  const codeOf = async (response: Response): Promise<string> =>
    ((await response.json()) as { error: { code: string } }).error.code;

  /** What a hostile page's `<form method="post">` sends: no custom header. */
  it('refuses a write without the request header', async () => {
    const response = await upload({});

    assert.equal(response.status, 403);
    assert.equal(await codeOf(response), 'CSRF_REJECTED');
  });

  it('refuses a write the browser says came from another site', async () => {
    const response = await upload({ ...CSRF, 'Sec-Fetch-Site': 'cross-site' });

    assert.equal(response.status, 403);
  });

  it('refuses a write from another origin', async () => {
    const response = await upload({ ...CSRF, Origin: 'https://evil.example' });

    assert.equal(response.status, 403);
  });

  it('accepts a write from this origin', async () => {
    const origin = new URL(base).origin;
    const response = await upload({ ...CSRF, Origin: origin, 'Sec-Fetch-Site': 'same-origin' });

    assert.equal(response.status, 201);
  });

  it('leaves reads alone', async () => {
    assert.equal((await fetch(`${base}/fs/list?path=`, { headers: { Origin: 'https://evil.example' } })).status, 200);
  });
});
