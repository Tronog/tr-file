import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import type { FileSystemBridge } from './bridge.service.js';
import {
  FS_BRIDGE_CHUNK_BYTES,
  type FsBridgeFailure,
  type FsBridgeResponse,
  type FsReadResult,
  type FsUploadBeginResult,
} from './bridge.model.js';
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

  /** A file never crosses whole: a caller walks it chunk by chunk. */
  it('reads a chunk from an offset, reporting the size of the whole file', async () => {
    const result = dataOf<FsReadResult>(
      await bridge.dispatch({ command: 'read', path: 'README.md', offset: 2, length: 3 }),
    );

    assert.equal(Buffer.from(result.content).toString(), 'hel');
    assert.equal(result.offset, 2);
    assert.equal(result.size, 8);
  });

  it('answers an empty chunk at the very end, and refuses to read past it', async () => {
    const end = dataOf<FsReadResult>(await bridge.dispatch({ command: 'read', path: 'README.md', offset: 8 }));
    assert.equal(end.content.byteLength, 0);

    const past = errorOf(await bridge.dispatch({ command: 'read', path: 'README.md', offset: 9 }));
    assert.equal(past.code, 'BAD_REQUEST');
  });

  it('refuses to read a directory', async () => {
    const error = errorOf(await bridge.dispatch({ command: 'read', path: '' }));

    assert.equal(error.code, 'BAD_REQUEST');
  });
});

/** Begins, sends and commits one upload; answers with whatever commit said. */
async function uploadInChunks(filename: string, chunks: readonly string[]): Promise<FsBridgeResponse> {
  const begun = await bridge.dispatch({ command: 'upload-begin', path: '', filename, overwrite: false });
  if ('error' in begun) {
    return begun;
  }
  const { uploadId } = begun.data as FsUploadBeginResult;
  for (const chunk of chunks) {
    const sent = await bridge.dispatch({ command: 'upload-chunk', uploadId, content: new TextEncoder().encode(chunk) });
    if ('error' in sent) {
      return sent;
    }
  }
  return bridge.dispatch({ command: 'upload-commit', uploadId });
}

describe('upload', () => {
  it('stores the chunks in order and answers with the stored file details', async () => {
    const details = dataOf<FileDetailsDto>(await uploadInChunks('note.txt', ['h', 'i']));

    assert.equal(details.path, 'note.txt');
    assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'hi');
  });

  /** Refused before a byte is sent, not after the whole file has crossed. */
  it('refuses to replace an existing file at begin, unless told to', async () => {
    const error = errorOf(
      await bridge.dispatch({ command: 'upload-begin', path: '', filename: 'note.txt', overwrite: false }),
    );

    assert.equal(error.code, 'CONFLICT');
    assert.equal(error.status, 409);
  });

  it('honours the same upload ceiling as HTTP, however the bytes are split', async () => {
    const half = 'x'.repeat(UPLOAD_LIMIT / 2 + 1);
    const error = errorOf(await uploadInChunks('big.txt', [half, half]));

    assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
    await assert.rejects(readFile(join(root, 'big.txt')));
  });

  it('keeps nothing of an aborted upload, not even its temporary file', async () => {
    const begun = dataOf<FsUploadBeginResult>(
      await bridge.dispatch({ command: 'upload-begin', path: '', filename: 'gone.txt', overwrite: false }),
    );
    dataOf(await bridge.dispatch({ command: 'upload-chunk', uploadId: begun.uploadId, content: new Uint8Array([1, 2]) }));

    dataOf(await bridge.dispatch({ command: 'upload-abort', uploadId: begun.uploadId }));

    const names = await readdir(root);
    assert.equal(names.includes('gone.txt'), false);
    assert.equal(names.some((name) => name.endsWith('.part')), false);
    // The session is over: a late chunk is refused rather than written.
    const late = errorOf(
      await bridge.dispatch({ command: 'upload-chunk', uploadId: begun.uploadId, content: new Uint8Array([3]) }),
    );
    assert.equal(late.code, 'NOT_FOUND');
  });

  it('refuses a chunk larger than the channel carries', async () => {
    const begun = dataOf<FsUploadBeginResult>(
      await bridge.dispatch({ command: 'upload-begin', path: '', filename: 'huge.txt', overwrite: false }),
    );
    const error = errorOf(
      await bridge.dispatch({
        command: 'upload-chunk',
        uploadId: begun.uploadId,
        content: new Uint8Array(FS_BRIDGE_CHUNK_BYTES + 1),
      }),
    );

    assert.equal(error.code, 'BAD_REQUEST');
    await bridge.dispatch({ command: 'upload-abort', uploadId: begun.uploadId });
  });
});

describe('saveCopy', () => {
  it('streams a file out to a destination and reports its progress', async () => {
    const destination = join(root, 'copy-of-readme.md');
    const seen: number[] = [];

    const result = dataOf<{ bytes: number }>(
      await bridge.saveCopy('README.md', destination, { onProgress: (loaded) => seen.push(loaded) }),
    );

    assert.equal(result.bytes, 8);
    assert.equal(await readFile(destination, 'utf8'), '# hello\n');
    assert.equal(seen.at(-1), 8);
    await rm(destination);
  });

  it('is confined to the root on the reading side, like every other command', async () => {
    const error = errorOf(await bridge.saveCopy('../../etc/passwd', join(root, 'nope')));

    assert.equal(error.code, 'FORBIDDEN');
  });

  it('leaves nothing behind when it is cancelled', async () => {
    const destination = join(root, 'cancelled.md');
    const controller = new AbortController();
    controller.abort();

    const error = errorOf(await bridge.saveCopy('README.md', destination, { signal: controller.signal }));

    assert.equal(error.code, 'ABORTED');
    await assert.rejects(readFile(destination));
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
      { command: 'read', path: '', offset: 1.5 },
      { command: 'upload-begin', path: '', overwrite: false },
      { command: 'upload-chunk', uploadId: 'x', content: 'not bytes' },
      { command: 'upload-commit' },
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
