import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FileSystemService } from './file-system.service';
import { SessionExpiryService } from '../auth/session-expiry.service';
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

  /** PRD 003, §2 — signing in goes over the bridge too, when the desktop asks for it. */
  describe('signing in', () => {
    it('asks, signs in and signs out with bridge commands', async () => {
      fake.answer = { data: { required: true, authenticated: true, username: 'ana' } };

      await fs.transport.authStatus();
      await fs.transport.login('ana', 'secret');
      await fs.transport.logout();

      expect(fake.sent).toEqual([
        { command: 'auth-status' },
        { command: 'login', username: 'ana', password: 'secret' },
        { command: 'logout' },
      ]);
    });

    it('reports a command refused for want of a session, but not a refused sign-in', async () => {
      const expiry = TestBed.inject(SessionExpiryService);
      fake.answer = { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue', status: 401 } };

      await fs.transport.login('ana', 'nope').catch(() => undefined);
      expect(expiry.expired()).toBe(0);

      await fs.readFt.list('').catch(() => undefined);
      expect(expiry.expired()).toBe(1);
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
  /** PRD 005, §1 — the file operations are commands like any other. */
  describe('file operations', () => {
    it('starts, polls and cancels a job with op-* commands', async () => {
      fake.answer = { data: { id: 'job-1', state: 'running' } };

      await fs.operationsFt.start({ kind: 'copy', sources: ['a.txt'], destination: 'docs', conflict: 'rename' });
      await fs.operationsFt.start({ kind: 'trash', paths: ['a.txt'] });
      await fs.operationsFt.start({ kind: 'empty-trash' });
      await fs.operationsFt.status('job-1');
      await fs.operationsFt.cancel('job-1');

      expect(fake.sent).toEqual([
        { command: 'op-copy', sources: ['a.txt'], destination: 'docs', conflict: 'rename' },
        { command: 'op-trash', paths: ['a.txt'] },
        { command: 'op-empty-trash' },
        { command: 'op-status', jobId: 'job-1' },
        { command: 'op-cancel', jobId: 'job-1' },
      ]);
    });

    it('asks whose trash it is once', async () => {
      fake.answer = { data: { trash: 'system' } };

      await expect(fs.operationsFt.operationsInfo()).resolves.toEqual({ trash: 'system' });
      await fs.operationsFt.operationsInfo();

      expect(fake.sent).toEqual([{ command: 'op-info' }]);
    });

    it('passes a conflict through with the names that clash', async () => {
      fake.answer = { error: { code: 'CONFLICT', message: 'taken', status: 409, details: { conflicts: ['a.txt'] } } };

      const failure = await fs.operationsFt
        .start({ kind: 'move', sources: ['a.txt'], destination: 'docs', conflict: 'fail' })
        .catch((error: unknown) => error as FsError);

      expect(failure).toBeInstanceOf(FsError);
      expect((failure as FsError).details).toEqual({ conflicts: ['a.txt'] });
    });
  });
});

/** PRD 003, §5 — the new commands, as the desktop transport sends them. */
describe('FsBridgeService — what every file manager has', () => {
  let fake: FakeBridge;
  let fs: FileSystemService;

  beforeEach(() => {
    fake = new FakeBridge();
    installBridge(fake);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    fs = TestBed.inject(FileSystemService);
  });

  afterEach(() => installBridge(undefined));

  it('renames, and makes folders and files, one command each', async () => {
    fake.answer = { data: DETAILS };

    await fs.editFt.rename('docs/a.txt', 'docs/b.txt');
    await fs.editFt.createFolder('docs', 'New Folder');
    await fs.editFt.createFile('', 'notes.txt');

    expect(fake.sent).toEqual([
      { command: 'rename', path: 'docs/a.txt', to: 'docs/b.txt' },
      { command: 'mkdir', path: 'docs', name: 'New Folder' },
      { command: 'create-file', path: '', name: 'notes.txt' },
    ]);
  });

  it('searches and watches', async () => {
    fake.answer = { data: { path: '', query: 'a', entries: [], truncated: false, scanned: 3 } };
    await fs.readFt.search('', 'a', 50);
    fake.answer = { data: { watchId: 'w1', changed: ['docs'] } };
    await expect(fs.readFt.watch(null, ['', 'docs'])).resolves.toEqual({ watchId: 'w1', changed: ['docs'] });

    expect(fake.sent).toEqual([
      { command: 'search', path: '', query: 'a', limit: 50 },
      { command: 'watch', watchId: null, paths: ['', 'docs'] },
    ]);
  });

  it('opens with the system and reveals through the main process, which can say no', async () => {
    expect(fs.systemFt.canReveal(false)).toBe(true);
    expect(fs.systemFt.canReveal(true)).toBe(false);

    fake.answer = { data: { opened: false } };
    await expect(fs.systemFt.open('tools/setup.exe', 'setup.exe')).resolves.toBe(false);
    fake.answer = { data: { revealed: true } };
    await fs.systemFt.reveal('docs');

    expect(fake.sent).toEqual([
      { command: 'shell-open', path: 'tools/setup.exe' },
      { command: 'shell-reveal', path: 'docs' },
    ]);
  });

  it('deletes and restores as jobs', async () => {
    fake.answer = { data: { id: 'j' } };
    await fs.operationsFt.start({ kind: 'delete', paths: ['a.txt'] });
    await fs.operationsFt.start({ kind: 'restore', ids: ['a.txt.1'] });

    expect(fake.sent).toEqual([
      { command: 'op-delete', paths: ['a.txt'] },
      { command: 'op-restore', ids: ['a.txt.1'] },
    ]);
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

  it('speaks /api/ops over HTTP', async () => {
    const fs = TestBed.inject(FileSystemService);
    const http = TestBed.inject(HttpTestingController);
    const job = { id: 'job 1', state: 'running' };

    const started = fs.operationsFt.start({ kind: 'copy', sources: ['a.txt'], destination: 'docs', conflict: 'fail' });
    const request = http.expectOne('/api/ops/copy');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ sources: ['a.txt'], destination: 'docs', conflict: 'fail' });
    request.flush({ data: job }, { status: 202, statusText: 'Accepted' });
    await expect(started).resolves.toEqual(job);

    const status = fs.operationsFt.status('job 1');
    http.expectOne({ method: 'GET', url: '/api/ops/jobs/job%201' }).flush({ data: job });
    await status;

    const cancel = fs.operationsFt.cancel('job 1');
    http.expectOne({ method: 'POST', url: '/api/ops/jobs/job%201/cancel' }).flush({ data: job });
    await cancel;

    const info = fs.operationsFt.operationsInfo();
    http.expectOne('/api/ops/info').flush({ data: { trash: 'server' } });
    await expect(info).resolves.toEqual({ trash: 'server' });
    http.verify();
  });

  /** PRD 003, §5, over HTTP: every write a POST the CSRF interceptor marks, search a GET. */
  it('speaks the new /api/fs endpoints', async () => {
    const fs = TestBed.inject(FileSystemService);
    const http = TestBed.inject(HttpTestingController);
    const details = { path: 'docs/b.txt' };

    const renamed = fs.editFt.rename('docs/a.txt', 'docs/b.txt');
    const rename = http.expectOne('/api/fs/rename');
    expect(rename.request.method).toBe('POST');
    expect(rename.request.body).toEqual({ path: 'docs/a.txt', to: 'docs/b.txt' });
    rename.flush({ data: details });
    await expect(renamed).resolves.toEqual(details);

    const folder = fs.editFt.createFolder('docs', 'New Folder');
    const mkdir = http.expectOne('/api/fs/mkdir');
    expect(mkdir.request.body).toEqual({ path: 'docs', name: 'New Folder' });
    mkdir.flush({ data: details }, { status: 201, statusText: 'Created' });
    await folder;

    const file = fs.editFt.createFile('', 'a b.txt');
    http.expectOne('/api/fs/create').flush({ data: details }, { status: 201, statusText: 'Created' });
    await file;

    const found = fs.readFt.search('docs', 'a b', 20);
    http.expectOne({ method: 'GET', url: '/api/fs/search?path=docs&query=a%20b&limit=20' }).flush({
      data: { path: 'docs', query: 'a b', entries: [], truncated: false, scanned: 0 },
    });
    await found;

    const watched = fs.readFt.watch('w1', ['docs']);
    const watch = http.expectOne('/api/fs/watch');
    expect(watch.request.body).toEqual({ watchId: 'w1', paths: ['docs'] });
    watch.flush({ data: { watchId: 'w1', changed: [] } });
    await watched;
    http.verify();
  });

  it('opens a file in a new browser tab, served inline, and cannot reveal one', async () => {
    const fs = TestBed.inject(FileSystemService);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(fs.systemFt.open('docs/a b.pdf', 'a b.pdf')).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('/api/fs/download?path=docs/a%20b.pdf&inline=true', '_blank', 'noopener');
    expect(fs.systemFt.canReveal(false)).toBe(false);
    await expect(fs.systemFt.reveal('docs')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    open.mockRestore();
  });
});
