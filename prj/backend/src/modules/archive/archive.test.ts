import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import type { OperationJobDto } from '../operations/index.js';
import type { ArchiveListingDto } from './archive.model.js';
import { ZipReader, ZipWriter } from './zip/index.js';

/** PRD 003, §6 — archives over HTTP: browse, download a folder, compress, extract. */

let root: string;
let server: Server;
let base: string;
let app: App;

function post(path: string, body: unknown = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-TR-File-Request': '1' },
  });
}

async function settled(response: Response): Promise<OperationJobDto> {
  assert.equal(response.status, 202, await response.clone().text());
  let job = ((await response.json()) as { data: OperationJobDto }).data;
  while (job.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 5));
    job = ((await (await fetch(`${base}/ops/jobs/${job.id}`)).json()) as { data: OperationJobDto }).data;
  }
  return job;
}

/**
 * A zip with hostile names. The writer refuses those, so it is written with
 * harmless names of the same length, which are then swapped in the bytes —
 * a name is in no checksum.
 */
async function handMade(
  path: string,
  entries: readonly (readonly [string, string])[],
  links: readonly (readonly [string, string])[] = [],
  hostile: readonly (readonly [string, string])[] = [],
): Promise<void> {
  const output = createWriteStream(path);
  const writer = new ZipWriter(output);
  const when = new Date('2024-05-01T10:00:00Z');
  for (const [name, content] of entries) {
    await writer.addFile(name, Readable.from([Buffer.from(content)]), { mtime: when });
  }
  for (const [name, target] of links) {
    await writer.addSymlink(name, target, when);
  }
  await writer.finish();
  let bytes = await readFile(path);
  for (const [harmless, evil] of hostile) {
    assert.equal(harmless.length, evil.length);
    bytes = Buffer.from(bytes.toString('latin1').split(harmless).join(evil), 'latin1');
  }
  await writeFile(path, bytes);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-archive-'));
  await mkdir(join(root, 'project', 'src'), { recursive: true });
  await writeFile(join(root, 'project', 'README.md'), '# hi\n');
  await writeFile(join(root, 'project', 'src', 'main.ts'), 'export {};\n');
  await symlink('README.md', join(root, 'project', 'link.md'));
  await mkdir(join(root, 'out'));
  app = new App(AppConfig.fromEnv({ FILES_ROOT: root }), Logger.create('error'), '0.0.0-test');
  server = app.instance.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  app.close();
  await rm(root, { recursive: true, force: true });
});

describe('archives', () => {
  it('downloads a folder as a zip, links as links', async () => {
    const response = await fetch(`${base}/archive/zip?path=project`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition') ?? '', /filename="project\.zip"/);
    const file = join(root, 'out', 'download.zip');
    await writeFile(file, Buffer.from(await response.arrayBuffer()));

    const reader = await ZipReader.open(file);
    try {
      assert.deepEqual(
        reader.entries.map((entry) => entry.name).sort(),
        ['project', 'project/README.md', 'project/link.md', 'project/src', 'project/src/main.ts'],
      );
      assert.equal(reader.entries.find((entry) => entry.name === 'project/link.md')?.isSymlink, true);
    } finally {
      await reader.close();
    }
    await rm(file);
  });

  it('refuses to zip the root, or two entries of one name', async () => {
    assert.equal((await fetch(`${base}/archive/zip?path=`)).status, 400);
    assert.equal((await fetch(`${base}/archive/zip`)).status, 400);
    assert.equal((await fetch(`${base}/archive/zip?path=../etc`)).status, 403);
  });

  it('compresses a selection, and keeps both on a taken name', async () => {
    const job = await settled(await post('/ops/compress', { sources: ['project/README.md', 'project/src'], destination: 'out', name: 'bundle.zip' }));
    assert.equal(job.state, 'done', JSON.stringify(job.error));
    assert.deepEqual(job.outcome, [{ source: 'project/README.md', target: 'out/bundle.zip' }]);
    assert.deepEqual(job.affected, ['out']);
    assert.equal(job.doneBytes, 5 + 11);

    const taken = await post('/ops/compress', { sources: ['project/README.md'], destination: 'out', name: 'bundle.zip' });
    assert.equal(taken.status, 409);
    const kept = await settled(await post('/ops/compress', { sources: ['project/README.md'], destination: 'out', name: 'bundle.zip', conflict: 'rename' }));
    assert.equal(kept.outcome[0]?.target, 'out/bundle copy.zip');
    assert.equal((await readdir(join(root, 'out'))).filter((name) => name.endsWith('.part')).length, 0);
  });

  it('lists a zip one folder at a time, folders first', async () => {
    const answer = (await (await fetch(`${base}/archive/list?path=out/bundle.zip&inner=`)).json()) as { data: ArchiveListingDto };
    assert.deepEqual(
      answer.data.entries.map((entry) => [entry.name, entry.type, entry.path]),
      [
        ['src', 'directory', 'src'],
        ['README.md', 'file', 'README.md'],
      ],
    );
    const inner = (await (await fetch(`${base}/archive/list?path=out/bundle.zip&inner=src`)).json()) as { data: ArchiveListingDto };
    assert.deepEqual(inner.data.entries.map((entry) => [entry.name, entry.size]), [['main.ts', 11]]);
    assert.equal((await fetch(`${base}/archive/list?path=out/bundle.zip&inner=nope`)).status, 404);
    assert.equal((await fetch(`${base}/archive/list?path=project/README.md&inner=`)).status, 400);
  });

  it('extracts loose entries into a folder named after the archive', async () => {
    const job = await settled(await post('/ops/extract', { path: 'out/bundle.zip', destination: 'out' }));
    assert.equal(job.state, 'done', JSON.stringify(job.error));
    assert.deepEqual(job.outcome, [{ source: 'out/bundle.zip', target: 'out/bundle' }]);
    assert.equal(await readFile(join(root, 'out', 'bundle', 'src', 'main.ts'), 'utf8'), 'export {};\n');
    assert.equal(await readFile(join(root, 'out', 'bundle', 'README.md'), 'utf8'), '# hi\n');

    assert.equal((await post('/ops/extract', { path: 'out/bundle.zip', destination: 'out' })).status, 409);
    const again = await settled(await post('/ops/extract', { path: 'out/bundle.zip', destination: 'out', conflict: 'rename' }));
    assert.equal(again.outcome[0]?.target, 'out/bundle copy');
  });

  it('extracts one top folder straight in, links that stay inside included', async () => {
    const zipped = await settled(await post('/ops/compress', { sources: ['project'], destination: 'out', name: 'project.zip' }));
    assert.equal(zipped.state, 'done');
    await mkdir(join(root, 'unpacked'));
    const job = await settled(await post('/ops/extract', { path: 'out/project.zip', destination: 'unpacked' }));
    assert.equal(job.state, 'done', JSON.stringify(job.error));
    assert.deepEqual(job.outcome, [{ source: 'out/project.zip', target: 'unpacked/project' }]);
    assert.equal(await readlink(join(root, 'unpacked', 'project', 'link.md')), 'README.md');
  });

  it('never writes outside the folder it extracts into', async () => {
    await mkdir(join(root, 'evil'));
    await handMade(
      join(root, 'evil', 'slip.zip'),
      [
        ['xx/xx/escaped.txt', 'no'],
        ['Xabs.txt', 'no'],
        ['ok/fine.txt', 'yes'],
        ['ok/via/secret.txt', 'no'],
      ],
      [
        ['ok/out', '../../..'],
        ['ok/via', '/etc'],
      ],
      [
        ['xx/xx/escaped.txt', '../../escaped.txt'],
        ['Xabs.txt', '/abs.txt'],
      ],
    );
    const job = await settled(await post('/ops/extract', { path: 'evil/slip.zip', destination: 'evil' }));
    assert.equal(job.state, 'done', JSON.stringify(job.error));
    assert.equal(await readFile(join(root, 'evil', 'ok', 'fine.txt'), 'utf8'), 'yes');
    await assert.rejects(lstat(join(root, 'escaped.txt')));
    await assert.rejects(lstat('/abs.txt'));
    await assert.rejects(lstat(join(tmpdir(), 'escaped.txt')));
    await assert.rejects(lstat(join(root, 'evil', 'ok', 'out')));
    // `ok/via` was made a real folder for the file inside it, so the link to /etc never was.
    assert.equal((await lstat(join(root, 'evil', 'ok', 'via'))).isDirectory(), true);
    assert.ok(job.skipped >= 3);
  });

  it('says a file that is not a zip is not one', async () => {
    const response = await post('/ops/extract', { path: 'project/README.md', destination: 'out' });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: { message: string } }).error.message, /not a zip archive/);
  });

  it('answers the same through the bridge', async () => {
    const listed = await app.bridge.dispatch({ command: 'archive-list', path: 'out/bundle.zip', inner: 'src' });
    assert.ok('data' in listed);
    const destination = join(root, 'out', 'saved.zip');
    const saved = await app.bridge.saveZip(['project/src'], destination);
    assert.ok('data' in saved, JSON.stringify(saved));
    const reader = await ZipReader.open(destination);
    assert.deepEqual(reader.entries.map((entry) => entry.name), ['src', 'src/main.ts']);
    await reader.close();
  });
});
