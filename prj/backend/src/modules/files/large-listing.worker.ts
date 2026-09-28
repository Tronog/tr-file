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
 * 1. `names`: every name the host has not already got (`known`, read on the
 *    way to finding the folder large — they keep their places, first), with
 *    the type the directory itself records — no `lstat` yet, so a million
 *    names cost one pass over the directory — handed over in chunks as they
 *    are read, not after the last;
 * 2. `names-done`: that was all of them, and so how many there are;
 * 3. `details`: `lstat` of each entry, a batch at a time, several at once —
 *    and, for a link, where it really leads, which the host judges against
 *    the root (the worker knows nothing of it);
 * 4. `done` — or `error`, when the folder itself cannot be read.
 *
 * Entries keep the index they were read at, so a batch of details says which
 * names it belongs to; one that vanished meanwhile is reported `gone`.
 */
export const LARGE_LISTING_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const { join } = require('node:path');

const { dir, skip, known, namesChunk, statBatch, concurrency } = workerData;
const skipped = new Set(skip);

function typeOf(stats) {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  return 'other';
}

// The names the host already has — its caller read them — come first, where the host has them;
// reading the folder again, they are passed over rather than listed twice.
const names = known.map(([name]) => name);
const types = known.map(([, type]) => type);
const already = new Set(names);

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
  let sent = names.length;
  const send = () => {
    if (sent < names.length) {
      parentPort.postMessage({ kind: 'names', names: names.slice(sent), types: types.slice(sent) });
      sent = names.length;
    }
  };
  for await (const dirent of handle) {
    if (skipped.has(dirent.name) || already.has(dirent.name)) continue;
    names.push(dirent.name);
    types.push(typeOf(dirent));
    if (names.length - sent >= namesChunk) send();
  }
  send();
  parentPort.postMessage({ kind: 'names-done', total: names.length });

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
