import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';

/** Small enough that a single short string trips the limit. */
const UPLOAD_LIMIT = 32;
/** A name with non-ASCII characters, to exercise the RFC 5987 parameter. */
const UNICODE_NAME = 'héllo wörld.txt';

let root: string;
let server: Server;
let base: string;

/** Builds a `multipart/form-data` body with the given file parts. */
function multipart(parts: readonly { field: string; filename: string; body: string }[]): FormData {
  const form = new FormData();
  for (const part of parts) {
    form.append(part.field, new Blob([part.body]), part.filename);
  }
  return form;
}

async function upload(query: string, form: FormData): Promise<Response> {
  // Every write carries the CSRF header, as the frontend's does (PRD 003, §2).
  return fetch(`${base}/upload${query}`, { method: 'POST', body: form, headers: { 'X-TR-File-Request': '1' } });
}

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-routes-'));
  await writeFile(join(root, UNICODE_NAME), 'hi there');

  const config = AppConfig.fromEnv({
    FILES_ROOT: root,
    UPLOAD_MAX_BYTES: String(UPLOAD_LIMIT),
  });
  server = new App(config, Logger.create('error'), '0.0.0-test').instance.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/fs`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('GET /api/fs/list', () => {
  it('serves the listing under a data envelope', async () => {
    const response = await fetch(`${base}/list`);
    const body = (await response.json()) as { data: { entries: { name: string }[] } };

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.data.entries.map((entry) => entry.name),
      [UNICODE_NAME],
    );
  });

  it('no longer answers the module root', async () => {
    assert.equal((await fetch(`${base}/`)).status, 404);
  });
});

describe('GET /api/fs/details', () => {
  it('serves the detail DTO', async () => {
    const response = await fetch(`${base}/details?path=${encodeURIComponent(UNICODE_NAME)}`);
    const body = (await response.json()) as { data: { mode: string; mimeType: string } };

    assert.equal(response.status, 200);
    assert.equal(body.data.mimeType, 'text/plain');
    assert.match(body.data.mode, /^[0-7]{4}$/);
  });
});

describe('GET /api/fs/download', () => {
  it('streams the bytes with an attachment disposition in both forms', async () => {
    const response = await fetch(`${base}/download?path=${encodeURIComponent(UNICODE_NAME)}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    const disposition = response.headers.get('content-disposition') ?? '';
    assert.match(disposition, /^attachment; filename="h_llo w_rld\.txt"/);
    assert.match(disposition, /filename\*=UTF-8''h%C3%A9llo%20w%C3%B6rld\.txt$/);
    assert.equal(await response.text(), 'hi there');
  });

  it('refuses to download a directory', async () => {
    const response = await fetch(`${base}/download?path=`);
    assert.equal(response.status, 400);
    assert.equal(await errorCodeOf(response), 'BAD_REQUEST');
  });
  /** The frontend asks for one byte to learn whether a download will work. */
  it('answers a one-byte range with that byte', async () => {
    const response = await fetch(`${base}/download?path=${encodeURIComponent(UNICODE_NAME)}`, {
      headers: { Range: 'bytes=0-0' },
    });

    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'h');
  });

  it('answers a range on an empty file with 416, not a server error', async () => {
    await writeFile(join(root, 'empty.txt'), '');

    const response = await fetch(`${base}/download?path=empty.txt`, { headers: { Range: 'bytes=0-0' } });

    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */0');
  });
});

describe('POST /api/fs/upload', () => {
  it('stores the file and answers 201 with its details', async () => {
    const response = await upload('', multipart([{ field: 'file', filename: 'a.txt', body: 'abc' }]));
    const body = (await response.json()) as { data: { path: string; size: number } };

    assert.equal(response.status, 201);
    assert.equal(body.data.path, 'a.txt');
    assert.equal(body.data.size, 3);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'abc');
  });

  it('answers 409 when the target exists and overwrite is not "true"', async () => {
    for (const query of ['', '?overwrite=1', '?overwrite=yes', '?overwrite=TRUE']) {
      const response = await upload(query, multipart([{ field: 'file', filename: 'a.txt', body: 'z' }]));
      assert.equal(response.status, 409, `overwrite query "${query}" should not overwrite`);
      assert.equal(await errorCodeOf(response), 'CONFLICT');
    }
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'abc');
  });

  it('replaces the target for overwrite=true', async () => {
    const response = await upload(
      '?overwrite=true',
      multipart([{ field: 'file', filename: 'a.txt', body: 'xyz' }]),
    );
    assert.equal(response.status, 201);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'xyz');
  });

  it('answers 413 above the configured byte limit', async () => {
    const response = await upload(
      '',
      multipart([{ field: 'file', filename: 'big.bin', body: 'y'.repeat(UPLOAD_LIMIT + 1) }]),
    );
    assert.equal(response.status, 413);
    assert.equal(await errorCodeOf(response), 'PAYLOAD_TOO_LARGE');
  });

  it('rejects a wrong field name, a second file part and a non-multipart body', async () => {
    const wrongField = await upload('', multipart([{ field: 'other', filename: 'a.txt', body: 'a' }]));
    assert.equal(wrongField.status, 400);

    const twoParts = await upload(
      '',
      multipart([
        { field: 'file', filename: 'one.txt', body: 'a' },
        { field: 'file', filename: 'two.txt', body: 'b' },
      ]),
    );
    assert.equal(twoParts.status, 400);

    const notMultipart = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-TR-File-Request': '1' },
      body: '{}',
    });
    assert.equal(notMultipart.status, 400);
  });

  it('rejects a traversing target directory with 403', async () => {
    const response = await upload(
      '?path=..%2F..',
      multipart([{ field: 'file', filename: 'a.txt', body: 'a' }]),
    );
    assert.equal(response.status, 403);
    assert.equal(await errorCodeOf(response), 'FORBIDDEN');
  });
});

/** PRD 003, §5 — a JSON write, with the CSRF header every write carries. */
function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-TR-File-Request': '1' },
  });
}

describe('GET /api/fs/download?inline=true', () => {
  it('serves inline, keeping the file name, and never sniffed', async () => {
    await writeFile(join(root, 'photo.png'), 'not really a png');

    const response = await fetch(`${base}/download?path=photo.png&inline=true`);
    await response.arrayBuffer();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), `inline; filename="photo.png"; filename*=UTF-8''photo.png`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-security-policy'), null);
  });

  it('sandboxes what could run script, and what it cannot name', async () => {
    await writeFile(join(root, 'page.html'), '<script>alert(1)</script>');
    await writeFile(join(root, 'drawing.svg'), '<svg/>');
    await writeFile(join(root, 'mystery.qqq'), '?');

    for (const name of ['page.html', 'drawing.svg', 'mystery.qqq']) {
      const response = await fetch(`${base}/download?path=${name}&inline=true`);
      await response.arrayBuffer();
      assert.equal(response.headers.get('content-security-policy'), 'sandbox', name);
      assert.match(response.headers.get('content-disposition') ?? '', /^inline;/);
    }
  });

  it('is an attachment for anything but the exact string "true"', async () => {
    for (const inline of ['1', 'TRUE', 'yes', '']) {
      const response = await fetch(`${base}/download?path=page.html&inline=${inline}`);
      await response.arrayBuffer();
      assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/, inline);
    }
  });
});

describe('POST /api/fs/rename, /mkdir, /create', () => {
  it('makes a folder and a file with 201, and renames with 200', async () => {
    const folder = await postJson('/mkdir', { path: '', name: 'made' });
    assert.equal(folder.status, 201);
    assert.equal(((await folder.json()) as { data: { path: string; type: string } }).data.type, 'directory');

    const file = await postJson('/create', { path: 'made', name: 'empty.md' });
    assert.equal(file.status, 201);
    assert.equal(((await file.json()) as { data: { path: string } }).data.path, 'made/empty.md');

    const renamed = await postJson('/rename', { path: 'made/empty.md', to: 'made/full.md' });
    assert.equal(renamed.status, 200);
    assert.equal(((await renamed.json()) as { data: { path: string } }).data.path, 'made/full.md');
    assert.equal(await readFile(join(root, 'made', 'full.md'), 'utf8'), '');
  });

  it('answers 409 for a taken name and 400 for a malformed body', async () => {
    const taken = await postJson('/create', { path: 'made', name: 'full.md' });
    assert.equal(taken.status, 409);
    assert.equal(await errorCodeOf(taken), 'CONFLICT');

    assert.equal((await postJson('/rename', { path: 'made/full.md' })).status, 400);
    assert.equal((await postJson('/mkdir', { path: '', name: 3 })).status, 400);
    assert.equal((await postJson('/rename', { path: 'made', to: 'made/inner' })).status, 400);
  });

  it('needs the CSRF header', async () => {
    const response = await fetch(`${base}/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path: '', name: 'sneaky' }),
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 403);
  });
});

describe('GET /api/fs/search', () => {
  it('answers matches with the walk’s bookkeeping', async () => {
    const response = await fetch(`${base}/search?path=&query=${encodeURIComponent('*.md')}`);
    const body = (await response.json()) as {
      data: { path: string; query: string; entries: { path: string }[]; truncated: boolean; scanned: number };
    };

    assert.equal(response.status, 200);
    assert.equal(body.data.query, '*.md');
    assert.deepEqual(body.data.entries.map((entry) => entry.path), ['made/full.md']);
    assert.equal(body.data.truncated, false);
    assert.ok(body.data.scanned > 0);
  });

  it('clamps a big limit and refuses a bad one or an empty query', async () => {
    assert.equal((await fetch(`${base}/search?query=a&limit=999999`)).status, 200);
    assert.equal((await fetch(`${base}/search?query=a&limit=0`)).status, 400);
    assert.equal((await fetch(`${base}/search?query=a&limit=ten`)).status, 400);
    assert.equal((await fetch(`${base}/search?query=%20`)).status, 400);
    assert.equal((await fetch(`${base}/search`)).status, 400);
  });

  it('truncates at the limit', async () => {
    const response = await fetch(`${base}/search?query=.&limit=1`);
    const body = (await response.json()) as { data: { entries: unknown[]; truncated: boolean } };

    assert.equal(body.data.entries.length, 1);
    assert.equal(body.data.truncated, true);
  });
});

describe('POST /api/fs/watch', () => {
  it('opens a session, then reports a change in a watched folder', async () => {
    const first = (await (await postJson('/watch', { watchId: null, paths: ['made'] })).json()) as {
      data: { watchId: string; changed: string[] };
    };
    assert.deepEqual(first.data.changed, []);

    await writeFile(join(root, 'made', 'fresh.txt'), 'x');

    const deadline = Date.now() + 3000;
    let changed: string[] = [];
    while (!changed.includes('made') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const next = (await (await postJson('/watch', { watchId: first.data.watchId, paths: ['made'] })).json()) as {
        data: { watchId: string; changed: string[] };
      };
      assert.equal(next.data.watchId, first.data.watchId);
      changed = next.data.changed;
    }
    assert.deepEqual(changed, ['made']);
  });

  it('refuses a malformed body and too many folders', async () => {
    assert.equal((await postJson('/watch', { watchId: 5, paths: [] })).status, 400);
    assert.equal((await postJson('/watch', { paths: 'made' })).status, 400);
    assert.equal((await postJson('/watch', { paths: Array.from({ length: 257 }, () => 'made') })).status, 400);
    assert.equal((await postJson('/watch', { paths: [] })).status, 200);
  });
});

/** PRD 004, §1.3.2 — *Copy Path* copies the full path, which only the server knows. */
describe('GET /api/fs/host-paths', () => {
  it('answers where entries are on the server, there or not', async () => {
    const response = await fetch(`${base}/host-paths?path=${encodeURIComponent(UNICODE_NAME)}&path=docs/not-yet.md&path=`);
    assert.equal(response.status, 200);
    const { data } = (await response.json()) as { data: { paths: string[] } };
    assert.deepEqual(data.paths, [join(root, UNICODE_NAME), join(root, 'docs', 'not-yet.md'), root]);
  });

  it('refuses a path outside the root, and a request naming none', async () => {
    assert.equal((await fetch(`${base}/host-paths?path=../etc/passwd`)).status, 403);
    assert.equal((await fetch(`${base}/host-paths`)).status, 400);
  });
});
