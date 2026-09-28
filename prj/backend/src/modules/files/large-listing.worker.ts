/**
 * The worker thread that reads a large folder (PRD 004, §3.1), as source.
 *
 * Kept as a string and started with `eval: true` because the backend runs as
 * TypeScript under `tsx`, as ES modules once built, and bundled into one
 * CommonJS file on the desktop — a worker *file* would sit at a different
 * path in each. The script needs nothing but Node's own modules.
 *
 * What it does, in order, each step a message to the host:
 *
 * 1. reads every name, with the type the directory itself records — no
 *    `lstat` yet, so a million names cost one pass over the directory;
 * 2. `count`: how many there are;
 * 3. `names`: the names and their types, in chunks;
 * 4. `details`: `lstat` of each entry, a batch at a time, several at once —
 *    and, for a link, where it really leads, which the host judges against
 *    the root (the worker knows nothing of it);
 * 5. `done` — or `error`, when the folder itself cannot be read.
 *
 * Entries keep the index they were read at, so a batch of details says which
 * names it belongs to; one that vanished meanwhile is reported `gone`.
 */
export const LARGE_LISTING_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const { join } = require('node:path');

const { dir, skip, namesChunk, statBatch, concurrency } = workerData;
const skipped = new Set(skip);

function typeOf(stats) {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  return 'other';
}

const names = [];
const types = [];

async function describe(index) {
  const absolute = join(dir, names[index]);
  try {
    const stats = await fs.lstat(absolute);
    const item = { index, type: typeOf(stats), size: stats.size, modified: stats.mtimeMs, created: stats.birthtimeMs };
    if (item.type === 'symlink') {
      try {
        const real = await fs.realpath(absolute);
        item.real = real;
        item.target = typeOf(await fs.stat(real));
      } catch {
        item.real = null;
      }
    }
    return item;
  } catch {
    return { index, gone: true };
  }
}

async function main() {
  const handle = await fs.opendir(dir, { bufferSize: 1024 });
  for await (const dirent of handle) {
    if (skipped.has(dirent.name)) continue;
    names.push(dirent.name);
    types.push(typeOf(dirent));
  }
  parentPort.postMessage({ kind: 'count', total: names.length });

  for (let from = 0; from < names.length; from += namesChunk) {
    parentPort.postMessage({ kind: 'names', names: names.slice(from, from + namesChunk), types: types.slice(from, from + namesChunk) });
  }
  parentPort.postMessage({ kind: 'names-done' });

  for (let from = 0; from < names.length; from += statBatch) {
    const end = Math.min(from + statBatch, names.length);
    const items = [];
    let next = from;
    const lane = async () => {
      while (next < end) {
        items.push(await describe(next++));
      }
    };
    await Promise.all(Array.from({ length: concurrency }, lane));
    items.sort((a, b) => a.index - b.index);
    parentPort.postMessage({ kind: 'details', items });
  }
  parentPort.postMessage({ kind: 'done' });
}

main().catch((error) => {
  parentPort.postMessage({ kind: 'error', code: (error && error.code) || null, message: String((error && error.message) || error) });
});
`;
