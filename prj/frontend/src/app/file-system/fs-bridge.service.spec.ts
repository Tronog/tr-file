import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FileSystemService } from './file-system.service';
import { BRIDGE_CHUNK_BYTES, FsBridgeService } from './fs-bridge.service';
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
  readonly saves: Sent[] = [];

  /**
   * What the next `invoke` resolves with. A function is called with the
   * request, so one test can answer a conversation; it may throw instead.
   */
  answer: unknown = { data: null };

  /** What `save` resolves with, by the same rules. */
  saveAnswer: unknown = { data: { saved: false } };

  readonly version = 2;

  private progressListeners: ((progress: unknown) => void)[] = [];

  invoke = async (request: unknown): Promise<unknown> => {
    this.sent.push(request as Sent);
    return typeof this.answer === 'function' ? (this.answer as (request: Sent) => unknown)(request as Sent) : this.answer;
  };

  save = async (request: unknown): Promise<unknown> => {
    this.saves.push(request as Sent);
    return typeof this.saveAnswer === 'function'
      ? (this.saveAnswer as (request: Sent) => unknown)(request as Sent)
      : this.saveAnswer;
  };

  onSaveProgress = (listener: (progress: unknown) => void): (() => void) => {
    this.progressListeners.push(listener);
    return () => {
      this.progressListeners = this.progressListeners.filter((candidate) => candidate !== listener);
    };
  };

  /** What the main process pushes while a save streams. */
  pushProgress(progress: unknown): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  get listening(): number {
    return this.progressListeners.length;
  }
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
      data: { size: 7, mimeType: 'text/markdown', content: new TextEncoder().encode('# hello') },
    };

    await expect(fs.transferFt.readText('docs/prd/001.md', 1024)).resolves.toBe('# hello');
    // `maxBytes` travels with the command so the backend can refuse *first*.
    expect(fake.sent).toEqual([
      { command: 'read', path: 'docs/prd/001.md', offset: 0, length: BRIDGE_CHUNK_BYTES, maxBytes: 1024 },
    ]);
  });

  /** PRD 003, §1: no file crosses the channel whole. */
  it('reads a large file chunk by chunk, asking from where the last one ended', async () => {
    fake.answer = (request: Sent) => ({
      data: {
        size: 5,
        mimeType: null,
        content: new TextEncoder().encode(request['offset'] === 0 ? 'abc' : 'de'),
      },
    });

    const blob = await fs.transferFt.download('big.bin');

    expect(await blob.text()).toBe('abcde');
    expect(fake.sent.map((request) => request['offset'])).toEqual([0, 3]);
  });

  describe('save()', () => {
    it('asks the main process to save, and reports the bytes it wrote', async () => {
      fake.saveAnswer = (request: Sent) => {
        fake.pushProgress({ transferId: request['transferId'], loaded: 2, total: 4 });
        fake.pushProgress({ transferId: 'someone-else', loaded: 4, total: 4 });
        return { data: { saved: true, bytes: 4 } };
      };

      const download = fs.transferFt.save('docs/a.bin', 'a.bin');
      await expect(download.result).resolves.toEqual({ outcome: 'saved', bytes: 4 });

      expect(fake.saves[0]).toMatchObject({ command: 'save', path: 'docs/a.bin', name: 'a.bin' });
      // Only its own transfer's progress, and the listener is gone afterwards.
      expect(download.progress()).toEqual({ loaded: 2, total: 4, percent: 50 });
      expect(fake.listening).toBe(0);
      // Nothing was read into the page to do it.
      expect(fake.sent).toEqual([]);
    });

    it('treats a dismissed Save dialog as a change of mind, not a failure', async () => {
      fake.saveAnswer = { data: { saved: false } };

      await expect(fs.transferFt.save('a.bin', 'a.bin').result).resolves.toEqual({ outcome: 'dismissed' });
    });

    it('passes on why a save failed', async () => {
      fake.saveAnswer = { error: { code: 'NOT_FOUND', message: 'Path not found: a.bin', status: 404 } };

      await expect(fs.transferFt.save('a.bin', 'a.bin').result).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('cancels by the id it gave the transfer', async () => {
      let finish: (value: unknown) => void = () => undefined;
      fake.saveAnswer = () => new Promise((resolve) => (finish = resolve));

      const download = fs.transferFt.save('a.bin', 'a.bin');
      download.cancel();

      await expect(download.result).rejects.toMatchObject({ code: 'ABORTED' });
      expect(fake.saves[1]).toEqual({ command: 'cancel', transferId: fake.saves[0]?.['transferId'] });
      finish({ error: { code: 'ABORTED', message: 'cancelled', status: 0 } });
    });
  });

  describe('upload()', () => {
    /** Answers the begin / chunk / commit conversation the way the backend does. */
    const answerUploads = (): void => {
      let received = 0;
      fake.answer = (request: Sent) => {
        switch (request['command']) {
          case 'upload-begin':
            return { data: { uploadId: 'u1' } };
          case 'upload-chunk':
            received += (request['content'] as Uint8Array).byteLength;
            return { data: { received } };
          case 'upload-commit':
            return { data: DETAILS };
          default:
            return { data: { aborted: true } };
        }
      };
    };

    it('begins, sends the file in chunks, and commits', async () => {
      answerUploads();
      const file = new File(['hi'], 'note.txt', { type: 'text/plain' });

      const upload = fs.transferFt.upload('docs', file, { overwrite: true });
      await expect(upload.result).resolves.toEqual(DETAILS);

      expect(fake.sent.map((request) => request['command'])).toEqual(['upload-begin', 'upload-chunk', 'upload-commit']);
      expect(fake.sent[0]).toEqual({ command: 'upload-begin', path: 'docs', filename: 'note.txt', overwrite: true });
      expect(new TextDecoder().decode(fake.sent[1]?.['content'] as Uint8Array)).toBe('hi');
      expect(upload.progress()).toEqual({ loaded: 2, total: 2, percent: 100 });
    });

    it('never sends more than one chunk’s worth at a time', async () => {
      answerUploads();
      const file = new File([new Uint8Array(BRIDGE_CHUNK_BYTES + 3)], 'big.bin');

      await fs.transferFt.upload('', file).result;

      const chunks = fake.sent.filter((request) => request['command'] === 'upload-chunk');
      expect(chunks.map((chunk) => (chunk['content'] as Uint8Array).byteLength)).toEqual([BRIDGE_CHUNK_BYTES, 3]);
    });

    it('sends an empty file as a begin and a commit', async () => {
      answerUploads();

      await fs.transferFt.upload('', new File([], 'empty.txt')).result;

      expect(fake.sent.map((request) => request['command'])).toEqual(['upload-begin', 'upload-commit']);
    });

    it('tells the backend to discard a cancelled upload, and sends no more', async () => {
      let releaseChunk: (value: unknown) => void = () => undefined;
      fake.answer = (request: Sent) => {
        switch (request['command']) {
          case 'upload-begin':
            return { data: { uploadId: 'u1' } };
          case 'upload-chunk':
            // Held open, so the cancel lands while a chunk is in flight.
            return new Promise((resolve) => (releaseChunk = resolve));
          default:
            return { data: { aborted: true } };
        }
      };

      const upload = fs.transferFt.upload('', new File([new Uint8Array(BRIDGE_CHUNK_BYTES + 1)], 'big.bin'));
      await vi.waitFor(() => expect(fake.sent.map((request) => request['command'])).toContain('upload-chunk'));
      upload.cancel();
      releaseChunk({ data: { received: BRIDGE_CHUNK_BYTES } });

      await expect(upload.result).rejects.toMatchObject({ code: 'ABORTED' });
      await new Promise((resolve) => setTimeout(resolve));
      expect(fake.sent.map((request) => request['command'])).toEqual(['upload-begin', 'upload-chunk', 'upload-abort']);
    });

    it('fails with the backend’s reason when begin is refused', async () => {
      fake.answer = { error: { code: 'CONFLICT', message: 'Target already exists: note.txt', status: 409 } };

      await expect(fs.transferFt.upload('', new File(['hi'], 'note.txt')).result).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
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
