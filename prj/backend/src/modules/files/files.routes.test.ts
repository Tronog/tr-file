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
  return fetch(`${base}/upload${query}`, { method: 'POST', body: form });
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
      headers: { 'content-type': 'application/json' },
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
