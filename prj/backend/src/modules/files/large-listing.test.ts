import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { HttpError, Logger } from '../../core/index.js';
import { FilePathResolver } from './file-path.resolver.js';
import { FilesService } from './files.service.js';
import { LargeListings, type ListingDetailDto, type ListingNameDto, type ListingProgressDto } from './large-listing.service.js';

/**
 * PRD 004, §3.1 — a folder at or past the threshold is read by stages in a
 * worker thread: count, names, then details in batches, asked after by cursor.
 * The limits are shrunk so a few dozen files exercise every stage.
 */

let root: string;
let outside: string;
let service: FilesService;
let listings: LargeListings;

const FILES = 24;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tr-file-large-'));
  outside = await mkdtemp(join(tmpdir(), 'tr-file-large-outside-'));
  const resolver = new FilePathResolver(root, ['.reserved']);
  const logger = Logger.create('error');
  listings = new LargeListings(resolver, logger, {
    threshold: 10,
    namesChunk: 4,
    statBatch: 3,
    concurrency: 2,
    namesPerAnswer: 5,
    detailsPerAnswer: 4,
  });
  service = new FilesService(resolver, logger, 64, listings);

  await mkdir(join(root, 'big'));
  for (let index = 0; index < FILES; index++) {
    await writeFile(join(root, 'big', `file-${index}.txt`), 'x'.repeat(index));
  }
  await mkdir(join(root, 'big', 'sub'));
  await symlink(join(root, 'big', 'sub'), join(root, 'big', 'link-in'));
  await symlink(outside, join(root, 'big', 'link-out'));

  await mkdir(join(root, 'small'));
  for (let index = 0; index < 9; index++) {
    await writeFile(join(root, 'small', `s-${index}`), '');
  }
  // The root itself: past the threshold, with a reserved name that is never listed.
  await mkdir(join(root, '.reserved'));
  for (let index = 0; index < 10; index++) {
    await writeFile(join(root, `r-${index}`), '');
  }
});

after(async () => {
  listings.close();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

/** Asks until `done`, as a client polling would, and gathers every answer. */
async function readAll(token: string): Promise<{ answers: ListingProgressDto[]; names: ListingNameDto[]; details: ListingDetailDto[] }> {
  const answers: ListingProgressDto[] = [];
  const names: ListingNameDto[] = [];
  const details: ListingDetailDto[] = [];
  let detailsFrom = 0;
  for (let round = 0; round < 500; round++) {
    const answer = service.listProgress(token, names.length, detailsFrom);
    answers.push(answer);
    names.push(...answer.names);
    details.push(...answer.details);
    detailsFrom += answer.details.length + answer.gone.length;
    if (answer.done) {
      return { answers, names, details };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the listing never finished');
}

describe('LargeListings', () => {
  it('lists a folder below the threshold at once, as ever', async () => {
    const listing = (await service.listDirectory('small')).toJSON();
    assert.equal(listing.progressive, undefined);
    assert.equal(listing.entries.length, 9);
  });

  it('hands a large folder to a worker: no entries, a token', async () => {
    const listing = (await service.listDirectory('big')).toJSON();
    assert.equal(listing.entries.length, 0);
    assert.equal(listing.path, 'big');
    assert.equal(typeof listing.progressive?.token, 'string');
  });

  it('answers the count, then every name, then every detail — in batches, from the cursors', async () => {
    const token = (await service.listDirectory('big')).toJSON().progressive?.token as string;
    const { answers, names, details } = await readAll(token);

    const total = FILES + 3;
    assert.equal(answers.at(-1)?.total, total);
    assert.equal(names.length, total);
    assert.deepEqual(new Set(names.map((name) => name.name)).size, total);
    // The directory's own record of each type, before any `lstat`.
    assert.equal(names.find((name) => name.name === 'sub')?.type, 'directory');
    assert.equal(names.find((name) => name.name === 'link-in')?.type, 'symlink');

    // No answer carried more than it may, and details only once every name was out.
    assert.ok(answers.every((answer) => answer.names.length <= 5 && answer.details.length <= 4));
    assert.ok(answers.every((answer) => answer.details.length === 0 || answer.namesDone));

    assert.equal(details.length, total);
    const detailOf = (name: string) => details.find((detail) => detail.index === names.findIndex((candidate) => candidate.name === name));
    assert.equal(detailOf('file-7.txt')?.size, 7);
    assert.equal(detailOf('file-7.txt')?.type, 'file');
    assert.ok(!Number.isNaN(Date.parse(detailOf('file-7.txt')?.modifiedAt ?? '')));
    // A link is judged against the root, as a small listing judges it.
    assert.equal(detailOf('link-in')?.targetType, 'directory');
    assert.equal(detailOf('link-out')?.targetType, null);
    assert.equal(detailOf('file-7.txt')?.targetType, undefined);
  });

  it('gives the same answer when asked again from the same place', async () => {
    const token = (await service.listDirectory('big')).toJSON().progressive?.token as string;
    await readAll(token);
    assert.deepEqual(service.listProgress(token, 3, 2), service.listProgress(token, 3, 2));
    assert.deepEqual(service.listProgress(token, 3, 0).names.map((name) => name.name).length, 5);
  });

  it('leaves the reserved names of the root out, as a small listing does', async () => {
    const token = (await service.listDirectory('')).toJSON().progressive?.token as string;
    const { names } = await readAll(token);
    assert.ok(!names.some((name) => name.name === '.reserved'));
    assert.ok(names.some((name) => name.name === 'big'));
  });

  it('says so when a token is unknown or forgotten', () => {
    assert.throws(
      () => service.listProgress('no-such-token'),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
  });

  it('forgets the listing asked about longest ago once it holds as many as it may', async () => {
    const few = new LargeListings(new FilePathResolver(root), Logger.create('error'), { threshold: 10, maxListings: 2 });
    const files = new FilesService(new FilePathResolver(root), Logger.create('error'), 64, few);
    try {
      const first = (await files.listDirectory('big')).toJSON().progressive?.token as string;
      await files.listDirectory('big');
      await files.listDirectory('big');
      assert.throws(() => files.listProgress(first), (error: unknown) => error instanceof HttpError && error.status === 404);
    } finally {
      few.close();
    }
  });
});
