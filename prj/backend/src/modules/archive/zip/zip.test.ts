import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import * as zlib from 'node:zlib';

import { Crc32, tableCrc32 } from './crc32.js';
import { ZipError, ZipReader, ZipWriter, type ZipEntry, type ZipWriterOptions } from './index.js';
import { decodeCp437 } from './zip-name.js';
import { SIG_ZIP64_EOCD, SIG_ZIP64_LOCATOR } from './zip.constants.js';

let dir: string;
let counter = 0;

const MTIME = new Date('2024-05-06T07:08:10Z');

/** Whether an external tool can be run at all; the checks that need it are skipped otherwise. */
function hasTool(command: string, args: readonly string[]): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
}

const hasPython = hasTool('python3', ['--version']);
const hasUnzip = hasTool('unzip', ['-v']);

/**
 * Python's own reading of the archive: every name, size and CRC, after
 * `testzip` has decompressed and checked each member. Python reads the
 * central directory and ZIP64 structures independently of this library.
 */
const PYTHON_DUMP = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    bad = z.testzip()
    if bad is not None:
        sys.exit('bad member: ' + bad)
    print(json.dumps([[i.filename, i.file_size, i.CRC] for i in z.infolist()]))
`;

function pythonListing(path: string): Array<[string, number, number]> {
  const test = spawnSync('python3', ['-m', 'zipfile', '-t', path], { encoding: 'utf8' });
  assert.equal(test.status, 0, `python3 -m zipfile -t failed: ${test.stderr}`);
  const dump = spawnSync('python3', ['-c', PYTHON_DUMP, path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(dump.status, 0, `python3 zipfile failed: ${dump.stderr}`);
  return JSON.parse(dump.stdout) as Array<[string, number, number]>;
}

function assertUnzipAccepts(path: string): void {
  const result = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, `unzip -t failed: ${result.stdout}${result.stderr}`);
}

async function writeArchive(
  build: (zip: ZipWriter) => Promise<void>,
  options: ZipWriterOptions = {},
): Promise<string> {
  const path = join(dir, `archive-${++counter}.zip`);
  const zip = new ZipWriter(createWriteStream(path), options);
  await build(zip);
  await zip.finish();
  return path;
}

async function readEntry(reader: ZipReader, entry: ZipEntry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await reader.openReadStream(entry)) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function entryNamed(reader: ZipReader, name: string): ZipEntry {
  const entry = reader.entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `no entry ${name}`);
  return entry;
}

/** A source that yields `chunks` one per macrotask, so an abort can land between them. */
function slowSource(chunks: number, size: number): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent === chunks) {
        this.push(null);
        return;
      }
      sent++;
      setTimeout(() => this.push(randomBytes(size)), 5);
    },
  });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tr-file-zip-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ZipWriter → ZipReader round trip', () => {
  const binary = randomBytes(3 * 1024 * 1024 + 17);
  const text = 'Hello, archive!\n'.repeat(1000);
  let path: string;

  before(async () => {
    path = await writeArchive(async (zip) => {
      await zip.addDirectory('docs', MTIME);
      await zip.addFile('docs/empty.txt', Readable.from([]), { mtime: MTIME });
      await zip.addFile('docs/readme.txt', Readable.from([Buffer.from(text)]), { mtime: MTIME, mode: 0o600 });
      await zip.addFile('bin/random.dat', Readable.from([binary.subarray(0, 1000), binary.subarray(1000)]), {
        mtime: MTIME,
      });
      await zip.addFile('ünïcødé/日本語 ✓.txt', Readable.from(['unicode content']), { mtime: MTIME, size: 15 });
      await zip.addFile('bin/stored.dat', Readable.from([binary.subarray(0, 4096)]), {
        mtime: MTIME,
        method: 'store',
      });
      await zip.addSymlink('docs/link', 'readme.txt', MTIME);
    });
  });

  it('reads back every entry with its metadata', async () => {
    const reader = await ZipReader.open(path);
    try {
      assert.deepEqual(
        reader.entries.map((entry) => entry.name),
        ['docs', 'docs/empty.txt', 'docs/readme.txt', 'bin/random.dat', 'ünïcødé/日本語 ✓.txt', 'bin/stored.dat', 'docs/link'],
      );
      assert.ok(reader.entries.every((entry) => !entry.unsafe && !entry.encrypted));

      const docs = entryNamed(reader, 'docs');
      assert.equal(docs.isDirectory, true);
      assert.equal(docs.mode, 0o040755);
      assert.equal(docs.rawName, 'docs/');

      const empty = entryNamed(reader, 'docs/empty.txt');
      assert.equal(empty.method, 0, 'an empty file is stored');
      assert.equal(empty.size, 0);
      assert.equal((await readEntry(reader, empty)).length, 0);

      const readme = entryNamed(reader, 'docs/readme.txt');
      assert.equal(readme.method, 8);
      assert.equal(readme.mode, 0o100600);
      assert.ok(readme.compressedSize < readme.size, 'repetitive text compresses');
      assert.equal(readme.mtime.getTime(), MTIME.getTime(), 'the extended timestamp keeps the exact second');
      assert.equal((await readEntry(reader, readme)).toString('utf8'), text);

      const random = entryNamed(reader, 'bin/random.dat');
      assert.equal(random.size, binary.length);
      assert.equal(random.crc32, Crc32.compute(binary));
      assert.ok((await readEntry(reader, random)).equals(binary));

      const unicode = entryNamed(reader, 'ünïcødé/日本語 ✓.txt');
      assert.equal((await readEntry(reader, unicode)).toString('utf8'), 'unicode content');

      const stored = entryNamed(reader, 'bin/stored.dat');
      assert.equal(stored.method, 0);
      assert.equal(stored.compressedSize, 4096);
      assert.ok((await readEntry(reader, stored)).equals(binary.subarray(0, 4096)));

      const link = entryNamed(reader, 'docs/link');
      assert.equal(link.isSymlink, true);
      assert.equal((await readEntry(reader, link)).toString('utf8'), 'readme.txt');
    } finally {
      await reader.close();
    }
  });

  it('is accepted by Python zipfile with the same names, sizes and CRCs', { skip: !hasPython }, async () => {
    const reader = await ZipReader.open(path);
    try {
      assert.deepEqual(
        pythonListing(path),
        reader.entries.map((entry) => [entry.rawName, entry.size, entry.crc32]),
      );
    } finally {
      await reader.close();
    }
  });

  it('is accepted by unzip -t', { skip: !hasUnzip }, () => {
    assertUnzipAccepts(path);
  });
});

describe('ZIP64', () => {
  let path: string;
  const content = randomBytes(200_000);

  before(async () => {
    path = await writeArchive(
      async (zip) => {
        await zip.addDirectory('big', MTIME);
        await zip.addFile('big/data.bin', Readable.from([content]), { mtime: MTIME, size: content.length });
        await zip.addFile('big/empty', Readable.from([]), { mtime: MTIME });
        await zip.addSymlink('big/link', 'data.bin', MTIME);
      },
      { forceZip64: true },
    );
  });

  it('writes the ZIP64 end records when forced', async () => {
    const bytes = await readFile(path);
    const locator = bytes.length - 22 - 20;
    assert.equal(bytes.readUInt32LE(locator), SIG_ZIP64_LOCATOR);
    assert.equal(bytes.readUInt32LE(locator - 56), SIG_ZIP64_EOCD);
    // The classic end record only holds markers, so a reader that got this right took the ZIP64 path.
    assert.equal(bytes.readUInt16LE(bytes.length - 22 + 10), 0xffff);
    assert.equal(bytes.readUInt32LE(bytes.length - 22 + 16), 0xffffffff);
  });

  it('reads it back', async () => {
    const reader = await ZipReader.open(path);
    try {
      assert.deepEqual(
        reader.entries.map((entry) => [entry.name, entry.size]),
        [
          ['big', 0],
          ['big/data.bin', content.length],
          ['big/empty', 0],
          ['big/link', 8],
        ],
      );
      assert.ok((await readEntry(reader, entryNamed(reader, 'big/data.bin'))).equals(content));
      assert.equal((await readEntry(reader, entryNamed(reader, 'big/link'))).toString(), 'data.bin');
    } finally {
      await reader.close();
    }
  });

  it('is accepted by Python zipfile', { skip: !hasPython }, () => {
    assert.deepEqual(
      pythonListing(path).map(([name, size]) => [name, size]),
      [
        ['big/', 0],
        ['big/data.bin', content.length],
        ['big/empty', 0],
        ['big/link', 8],
      ],
    );
  });

  it('is accepted by unzip -t', { skip: !hasUnzip }, () => {
    assertUnzipAccepts(path);
  });

  it('writes the ZIP64 end records by itself past 65 534 entries', async () => {
    const many = await writeArchive(async (zip) => {
      for (let i = 0; i < 65_536; i++) {
        await zip.addDirectory(`d${i}`, MTIME);
      }
    });
    const bytes = await readFile(many);
    assert.equal(bytes.readUInt32LE(bytes.length - 22 - 20), SIG_ZIP64_LOCATOR);
    const reader = await ZipReader.open(many);
    try {
      assert.equal(reader.entries.length, 65_536);
      assert.equal(reader.entries.at(-1)?.name, 'd65535');
    } finally {
      await reader.close();
    }
    if (hasPython) {
      assert.equal(pythonListing(many).length, 65_536);
    }
  });
});

describe('ZipReader.safeName and unsafe entries', () => {
  it('normalizes or refuses names', () => {
    assert.equal(ZipReader.safeName('a/b/c.txt'), 'a/b/c.txt');
    assert.equal(ZipReader.safeName('./a//b/'), 'a/b');
    assert.equal(ZipReader.safeName('a\\b'), 'a/b');
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'a\\..\\..\\x', 'C:/x', 'c:x', 'a\0b', '', '.', '//server/share']) {
      assert.equal(ZipReader.safeName(bad), null, JSON.stringify(bad));
    }
  });

  it('flags unsafe entries and leaves them out of list', async () => {
    // The writer refuses these names, so they are written as same-length
    // placeholders and patched in the bytes (both headers of each entry).
    const patches: Array<[string, string]> = [
      ['QQ/evil.txt', '../evil.txt'],
      ['Wabs.txt', '/abs.txt'],
      ['C;drive.txt', 'C:drive.txt'],
      ['kXXXXXXXk', 'k\\..\\..\\k'],
    ];
    const path = await writeArchive(async (zip) => {
      await zip.addFile('ok.txt', Readable.from(['fine']), { mtime: MTIME });
      for (const [placeholder] of patches) {
        await zip.addFile(placeholder, Readable.from(['x']), { mtime: MTIME });
      }
    });
    let bytes = await readFile(path);
    for (const [placeholder, name] of patches) {
      const from = Buffer.from(placeholder);
      const to = Buffer.from(name);
      assert.equal(from.length, to.length);
      for (let at = bytes.indexOf(from); at !== -1; at = bytes.indexOf(from, at + 1)) {
        to.copy(bytes, at);
      }
    }
    await writeFile(path, bytes);
    bytes = Buffer.alloc(0);

    const reader = await ZipReader.open(path);
    try {
      assert.deepEqual(
        reader.entries.map((entry) => [entry.name, entry.unsafe]),
        [
          ['ok.txt', false],
          ['../evil.txt', true],
          ['/abs.txt', true],
          ['C:drive.txt', true],
          ['k\\..\\..\\k', true],
        ],
      );
      assert.deepEqual(reader.list('')?.map((item) => item.name), ['ok.txt']);
    } finally {
      await reader.close();
    }
  });

  it('refuses unsafe names when writing, without breaking the archive', async () => {
    const path = await writeArchive(async (zip) => {
      await assert.rejects(zip.addFile('../x', Readable.from(['x']), { mtime: MTIME }), { code: 'INVALID_NAME' });
      await assert.rejects(zip.addDirectory('/abs', MTIME), { code: 'INVALID_NAME' });
      await zip.addFile('fine.txt', Readable.from(['x']), { mtime: MTIME });
    });
    const reader = await ZipReader.open(path);
    assert.deepEqual(reader.entries.map((entry) => entry.name), ['fine.txt']);
    await reader.close();
  });
});

describe('ZipReader.list', () => {
  let reader: ZipReader;

  before(async () => {
    const path = await writeArchive(async (zip) => {
      await zip.addFile('a/b/c.txt', Readable.from(['c']), { mtime: MTIME });
      await zip.addFile('a/d.txt', Readable.from(['dd']), { mtime: MTIME });
      await zip.addFile('e.txt', Readable.from(['eee']), { mtime: MTIME });
      await zip.addDirectory('x', MTIME);
      await zip.addDirectory('a', MTIME);
    });
    reader = await ZipReader.open(path);
  });

  after(async () => {
    await reader.close();
  });

  it('synthesizes folders that exist only through deeper entries', () => {
    const top = reader.list('');
    assert.deepEqual(
      top?.map((item) => [item.name, item.path, item.isDirectory, item.size]),
      [
        ['a', 'a', true, 0],
        ['e.txt', 'e.txt', false, 3],
        ['x', 'x', true, 0],
      ],
    );
    // `a` became explicit when its own entry turned up later.
    assert.equal(top?.[0]?.mtime?.getTime(), MTIME.getTime());
    assert.deepEqual(
      reader.list('a')?.map((item) => [item.name, item.path, item.isDirectory, item.mtime === null]),
      [
        ['b', 'a/b', true, true],
        ['d.txt', 'a/d.txt', false, false],
      ],
    );
    assert.deepEqual(reader.list('/a/b/')?.map((item) => item.path), ['a/b/c.txt']);
    assert.deepEqual(reader.list('x'), []);
  });

  it('answers null for a folder that is not there', () => {
    assert.equal(reader.list('nope'), null);
    assert.equal(reader.list('e.txt'), null);
    assert.equal(reader.list('../a'), null);
  });
});

describe('ZipWriter abort', () => {
  it('rejects with an AbortError, destroys the source and refuses further entries', async () => {
    const path = join(dir, 'aborted.zip');
    const zip = new ZipWriter(createWriteStream(path));
    await zip.addFile('first.txt', Readable.from(['kept']), { mtime: MTIME });

    const controller = new AbortController();
    const source = slowSource(1000, 1024);
    let read = 0;
    const adding = zip.addFile('slow.bin', source, {
      mtime: MTIME,
      signal: controller.signal,
      onBytes: (bytes) => {
        read += bytes;
        if (read >= 4096) {
          controller.abort();
        }
      },
    });
    await assert.rejects(adding, { name: 'AbortError' });
    assert.equal(source.destroyed, true);
    assert.ok(read < 1000 * 1024);
    await assert.rejects(zip.addDirectory('after', MTIME), (error: unknown) => {
      assert.ok(error instanceof ZipError);
      assert.equal(error.code, 'WRITER_FAILED');
      return true;
    });
  });

  it('leaves the archive intact when aborted before the entry starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const path = await writeArchive(async (zip) => {
      await zip.addFile('a.txt', Readable.from(['a']), { mtime: MTIME });
      await assert.rejects(
        zip.addFile('b.txt', Readable.from(['b']), { mtime: MTIME, signal: controller.signal }),
        { name: 'AbortError' },
      );
      await zip.addFile('c.txt', Readable.from(['c']), { mtime: MTIME });
    });
    const reader = await ZipReader.open(path);
    try {
      assert.deepEqual(reader.entries.map((entry) => entry.name), ['a.txt', 'c.txt']);
      assert.equal((await readEntry(reader, entryNamed(reader, 'c.txt'))).toString(), 'c');
    } finally {
      await reader.close();
    }
  });
});

describe('ZipReader integrity', () => {
  it('errors the stream on a CRC mismatch', async () => {
    const content = Buffer.from('0123456789abcdef'.repeat(64));
    const path = await writeArchive(async (zip) => {
      await zip.addFile('stored.txt', Readable.from([content]), { mtime: MTIME, method: 'store' });
    });
    const bytes = await readFile(path);
    const at = bytes.indexOf(content);
    assert.ok(at > 0);
    bytes[at + 100] = bytes[at + 100]! ^ 0xff;
    await writeFile(path, bytes);

    const reader = await ZipReader.open(path);
    try {
      await assert.rejects(readEntry(reader, entryNamed(reader, 'stored.txt')), { code: 'CRC_MISMATCH' });
    } finally {
      await reader.close();
    }
  });

  it('errors the stream on damaged deflate data', async () => {
    const content = randomBytes(50_000);
    const path = await writeArchive(async (zip) => {
      await zip.addFile('data.bin', Readable.from([content]), { mtime: MTIME });
    });
    const bytes = await readFile(path);
    for (let i = 200; i < 400; i++) {
      bytes[i] = bytes[i]! ^ 0x5a;
    }
    await writeFile(path, bytes);

    const reader = await ZipReader.open(path);
    try {
      await assert.rejects(readEntry(reader, entryNamed(reader, 'data.bin')));
    } finally {
      await reader.close();
    }
  });

  it('refuses a file that is not a ZIP', async () => {
    const path = join(dir, 'not.zip');
    await writeFile(path, randomBytes(5000));
    await assert.rejects(ZipReader.open(path), { code: 'NOT_A_ZIP' });
    await writeFile(path, 'tiny');
    await assert.rejects(ZipReader.open(path), { code: 'NOT_A_ZIP' });
  });

  it('refuses a central directory over the bound', async () => {
    const path = await writeArchive(async (zip) => {
      await zip.addDirectory('a', MTIME);
      await zip.addDirectory('b', MTIME);
    });
    await assert.rejects(ZipReader.open(path, { maxCentralDirectoryBytes: 10 }), { code: 'TOO_LARGE' });
    await assert.rejects(ZipReader.open(path, { maxEntries: 1 }), { code: 'TOO_LARGE' });
  });

  it('reads an archive with data prepended to it', async () => {
    const path = await writeArchive(async (zip) => {
      await zip.addFile('inner.txt', Readable.from(['inside']), { mtime: MTIME });
    });
    await writeFile(path, Buffer.concat([randomBytes(1234), await readFile(path)]));
    const reader = await ZipReader.open(path);
    try {
      assert.equal((await readEntry(reader, entryNamed(reader, 'inner.txt'))).toString(), 'inside');
    } finally {
      await reader.close();
    }
  });

  it('reads archives written by Python', { skip: !hasPython }, async () => {
    const path = join(dir, 'python.zip');
    const script = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('plain/ascii.txt', b'ascii' * 100)
    z.writestr('Grüße.txt', b'utf8 name')
`;
    const result = spawnSync('python3', ['-c', script, path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const reader = await ZipReader.open(path);
    try {
      assert.deepEqual(reader.entries.map((entry) => entry.name), ['plain/ascii.txt', 'Grüße.txt']);
      assert.equal((await readEntry(reader, entryNamed(reader, 'plain/ascii.txt'))).toString(), 'ascii'.repeat(100));
      assert.deepEqual(reader.list('')?.map((item) => [item.name, item.isDirectory]), [
        ['plain', true],
        ['Grüße.txt', false],
      ]);
    } finally {
      await reader.close();
    }
  });
});

describe('Crc32 and names', () => {
  it('computes the same CRC-32 with the table as zlib does', () => {
    const data = randomBytes(100_000);
    assert.equal(tableCrc32(data), Crc32.compute(data));
    assert.equal(tableCrc32(data.subarray(500), tableCrc32(data.subarray(0, 500))), tableCrc32(data));
    assert.equal(tableCrc32(Buffer.from('123456789')), 0xcbf43926);
    const native = (zlib as unknown as { crc32?: (data: Uint8Array) => number }).crc32;
    if (native) {
      assert.equal(native(data) >>> 0, tableCrc32(data));
    }
  });

  it('decodes CP437 names', () => {
    assert.equal(decodeCp437(Buffer.from([0x81, 0x62, 0x65, 0x72, 0x2e, 0x74, 0x78, 0x74])), 'über.txt');
    assert.equal(decodeCp437(Buffer.from([0xff, 0x80])), '\u00a0Ç');
  });
});
