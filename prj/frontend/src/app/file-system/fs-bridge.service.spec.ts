import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FileSystemService } from './file-system.service';
import { FsBridgeService } from './fs-bridge.service';
import { FsError } from './fs-error';
import type { FsDetails, FsDirectoryListing } from './file-system.model';

/**
 * PRD 001, §8.1 — the desktop transport. The preload is stubbed here, so what
 * is under test is the frontend half of the contract: the commands sent, the
 * payloads unwrapped, and the failures turned back into `FsError`.
 */

const LISTING: FsDirectoryListing = {
  path: 'docs',
  parent: '',
  entries: [
    {
      name: 'prd',
      path: 'docs/prd',
      type: 'directory',
      size: 4096,
      hidden: false,
      modifiedAt: '2026-01-02T03:04:05.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const DETAILS = { name: '001.md', path: 'docs/prd/001.md', size: 12 } as unknown as FsDetails;

/** One recorded command, so a test can assert what crossed the channel. */
type Sent = Record<string, unknown>;

/** Stands in for the sandboxed preload's `window.trFileBridge`. */
class FakeBridge {
  readonly sent: Sent[] = [];

  /** What the next `invoke` resolves with; a function may throw instead. */
  answer: unknown = { data: null };

  readonly version = 1;

  invoke = async (request: unknown): Promise<unknown> => {
    this.sent.push(request as Sent);
    if (typeof this.answer === 'function') {
      return (this.answer as () => unknown)();
    }
    return this.answer;
  };
}

function installBridge(bridge: FakeBridge | undefined): void {
  Object.defineProperty(window, 'trFileBridge', {
    value: bridge,
    configurable: true,
    writable: true,
  });
}

describe('FsBridgeService', () => {
  let fake: FakeBridge;
  let fs: FileSystemService;
  let bridge: FsBridgeService;
  let http: HttpTestingController;

  beforeEach(() => {
    fake = new FakeBridge();
    installBridge(fake);

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fs = TestBed.inject(FileSystemService);
    bridge = TestBed.inject(FsBridgeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Not one HTTP request may escape while the bridge is in place — that is
    // the whole point of the section.
    http.verify();
    installBridge(undefined);
  });

  it('is the transport the app picks when the preload is present', () => {
    expect(bridge.isAvailable).toBe(true);
    expect(fs.transport).toBe(bridge);
    expect(fs.transport.kind).toBe('desktop');
  });

  it('lists a directory with one command and no request', async () => {
    fake.answer = { data: LISTING };

    await expect(fs.readFt.list('docs')).resolves.toEqual(LISTING);
    expect(fake.sent).toEqual([{ command: 'list', path: 'docs' }]);
  });

  it('describes an entry with one command', async () => {
    fake.answer = { data: DETAILS };

    await expect(fs.readFt.details('docs/prd/001.md')).resolves.toEqual(DETAILS);
    expect(fake.sent).toEqual([{ command: 'details', path: 'docs/prd/001.md' }]);
  });

  it('reads a file as a blob, passing the caller’s size limit down', async () => {
    fake.answer = {
      data: {
        name: '001.md',
        size: 7,
        mimeType: 'text/markdown',
        content: new TextEncoder().encode('# hello'),
      },
    };

    await expect(fs.transferFt.readText('docs/prd/001.md', 1024)).resolves.toBe('# hello');
    // `maxBytes` travels with the command so the backend can refuse *first*.
    expect(fake.sent).toEqual([
      { command: 'read', path: 'docs/prd/001.md', maxBytes: 1024 },
    ]);
  });

  /** An HTTP URL does not exist here, so the bytes become an object URL. */
  it('wraps a file in an object URL to save it, and releases it again', async () => {
    fake.answer = {
      data: { name: 'a.bin', size: 2, mimeType: null, content: new Uint8Array([1, 2]) },
    };
    const created: string[] = [];
    const revoked: string[] = [];
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      const url = `blob:fake/${(blob as Blob).size}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => void revoked.push(url);

    const target = await fs.transferFt.saveUrl('a.bin');
    expect(target.url).toBe(created[0]);

    target.release();
    expect(revoked).toEqual(created);
  });

  it('uploads by handing the bytes over in one command', async () => {
    fake.answer = { data: DETAILS };
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' });

    const upload = fs.transferFt.upload('docs', file, { overwrite: true });
    await expect(upload.result).resolves.toEqual(DETAILS);

    const sent = fake.sent[0];
    expect(sent['command']).toBe('upload');
    expect(sent['path']).toBe('docs');
    expect(sent['filename']).toBe('note.txt');
    expect(sent['overwrite']).toBe(true);
    expect(new TextDecoder().decode(sent['content'] as Uint8Array)).toBe('hi');
    // One hand-off, so progress is start and finish rather than a curve.
    expect(upload.progress()).toEqual({ loaded: 2, total: 2, percent: 100 });
  });

  /**
   * The backend flattens its failures into data precisely so this holds: a
   * caller cannot tell which transport refused it.
   */
  it('rebuilds a backend refusal as the very same FsError HTTP would raise', async () => {
    fake.answer = {
      error: {
        code: 'NOT_FOUND',
        message: 'No such path',
        status: 404,
        details: { path: 'nope' },
      },
    };

    const error = await fs.readFt.list('nope').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FsError);
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such path',
      details: { path: 'nope' },
    });
  });

  it('reports a broken channel rather than hanging', async () => {
    fake.answer = () => {
      throw new Error('the main process went away');
    };

    const error = await fs.readFt.details('docs').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FsError);
    expect((error as FsError).code).toBe('UNKNOWN_ERROR');
  });

  it('rejects an answer that is not the contract envelope', async () => {
    fake.answer = 'nonsense';

    const error = await fs.readFt.list('docs').catch((thrown: unknown) => thrown);

    expect((error as FsError).code).toBe('UNKNOWN_ERROR');
  });

  /** A preload from an older build must not be spoken to in a newer dialect. */
  it('ignores a bridge whose contract version it does not know', () => {
    installBridge({ ...fake, version: 99 } as unknown as FakeBridge);

    expect(bridge.isAvailable).toBe(false);
  });
});

describe('FileSystemService without a desktop bridge', () => {
  beforeEach(() => {
    installBridge(undefined);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('falls back to HTTP, which is every browser', () => {
    expect(TestBed.inject(FsBridgeService).isAvailable).toBe(false);
    expect(TestBed.inject(FileSystemService).transport.kind).toBe('http');
  });
});
