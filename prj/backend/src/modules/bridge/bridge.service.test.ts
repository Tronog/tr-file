import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import type { FileSystemBridge } from './bridge.service.js';
import type { FsBridgeFailure, FsBridgeResponse, FsReadResult } from './bridge.model.js';
import type { DirectoryListingDto, FileDetailsDto } from '../files/models/index.js';

/** Small enough that one short string trips the limit, as in the routes test. */
const UPLOAD_LIMIT = 32;

let root: string;
let bridge: FileSystemBridge;

/** Narrows a response to its payload, failing the test if it was an error. */
function dataOf<T>(response: FsBridgeResponse): T {
  assert.ok('data' in response, `expected data, got ${JSON.stringify(response)}`);
  return response.data as T;
}

/** Narrows a response to its error, failing the test if it succeeded. */
function errorOf(response: FsBridgeResponse): FsBridgeFailure['error'] {
  assert.ok('error' in response, `expected an error, got ${JSON.stringify(response)}`);
  return response.error;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-bridge-'));
  await writeFile(join(root, 'README.md'), '# hello\n');

  const config = AppConfig.fromEnv({ FILES_ROOT: root, UPLOAD_MAX_BYTES: String(UPLOAD_LIMIT) });
  bridge = new App(config, Logger.create('error'), '0.0.0-test').bridge;
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('list', () => {
  it('returns the same payload the HTTP route serves', async () => {
    const listing = dataOf<DirectoryListingDto>(await bridge.dispatch({ command: 'list', path: '' }));

    assert.equal(listing.path, '');
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      ['README.md'],
    );
  });

  /** The bridge is not a second, laxer door: it shares the path resolver. */
  it('is confined to the files root exactly as HTTP is', async () => {
    const error = errorOf(await bridge.dispatch({ command: 'list', path: '../..' }));

    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.status, 403);
  });

  it('reports a missing directory as NOT_FOUND', async () => {
    const error = errorOf(await bridge.dispatch({ command: 'list', path: 'nowhere' }));

    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.status, 404);
  });
});

describe('details', () => {
  it('returns the full metadata of one entry', async () => {
    const details = dataOf<FileDetailsDto>(
      await bridge.dispatch({ command: 'details', path: 'README.md' }),
    );

    assert.equal(details.name, 'README.md');
    assert.equal(details.type, 'file');
    assert.equal(details.size, 8);
  });
});

describe('read', () => {
  it('returns the bytes, with the metadata the headers would have carried', async () => {
    const result = dataOf<FsReadResult>(await bridge.dispatch({ command: 'read', path: 'README.md' }));

    assert.ok(result.content instanceof Uint8Array);
    assert.equal(Buffer.from(result.content).toString(), '# hello\n');
    assert.equal(result.name, 'README.md');
    assert.equal(result.mimeType, 'text/markdown');
  });

  /** Refused before the read, not after: nothing oversized ever hits memory. */
  it('refuses a file past maxBytes without reading it', async () => {
    const error = errorOf(await bridge.dispatch({ command: 'read', path: 'README.md', maxBytes: 4 }));

    assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(error.status, 413);
  });

  it('refuses to read a directory', async () => {
    const error = errorOf(await bridge.dispatch({ command: 'read', path: '' }));

    assert.equal(error.code, 'BAD_REQUEST');
  });
});

describe('upload', () => {
  it('stores the bytes and answers with the stored file details', async () => {
    const response = await bridge.dispatch({
      command: 'upload',
      path: '',
      filename: 'note.txt',
      content: new TextEncoder().encode('hi'),
      overwrite: false,
    });
    const details = dataOf<FileDetailsDto>(response);

    assert.equal(details.path, 'note.txt');
    assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'hi');
  });

  it('refuses to replace an existing file unless told to', async () => {
    const error = errorOf(
      await bridge.dispatch({
        command: 'upload',
        path: '',
        filename: 'note.txt',
        content: new TextEncoder().encode('again'),
        overwrite: false,
      }),
    );

    assert.equal(error.code, 'CONFLICT');
    assert.equal(error.status, 409);
  });

  it('honours the same upload ceiling as HTTP', async () => {
    const error = errorOf(
      await bridge.dispatch({
        command: 'upload',
        path: '',
        filename: 'big.txt',
        content: new TextEncoder().encode('x'.repeat(UPLOAD_LIMIT + 1)),
        overwrite: false,
      }),
    );

    assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
  });
});

describe('a malformed request', () => {
  /** It arrives from a renderer over IPC, so the type is a hope, not a fact. */
  it('is rejected rather than trusted', async () => {
    const cases: readonly unknown[] = [
      null,
      'list',
      { command: 'destroy', path: '' },
      { command: 'list' },
      { command: 'list', path: 7 },
      { command: 'read', path: '', maxBytes: -1 },
      { command: 'upload', path: '', filename: 'x', content: 'not bytes', overwrite: false },
    ];

    for (const value of cases) {
      const error = errorOf(await bridge.dispatch(value));
      assert.equal(error.code, 'BAD_REQUEST', `expected BAD_REQUEST for ${JSON.stringify(value)}`);
      assert.equal(error.status, 400);
    }
  });

  /** A thrown error would arrive at the renderer as an empty object. */
  it('never throws, so nothing is lost crossing the channel', async () => {
    await assert.doesNotReject(() => bridge.dispatch(undefined));
  });
});
