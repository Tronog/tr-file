import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FileSystemService } from '../file-system.service';
import type { FsDetails } from '../file-system.model';
import { FsError } from '../fs-error';

const UPLOADED: FsDetails = {
  name: 'notes.txt',
  path: 'docs/notes.txt',
  type: 'file',
  size: 11,
  hidden: false,
  modifiedAt: '2026-01-02T03:04:05.000Z',
  createdAt: '2026-01-02T03:04:05.000Z',
  parent: 'docs',
  accessedAt: '2026-01-02T03:04:05.000Z',
  changedAt: '2026-01-02T03:04:05.000Z',
  mode: '0644',
  permissions: {
    owner: { read: true, write: true, execute: false },
    group: { read: true, write: false, execute: false },
    others: { read: true, write: false, execute: false },
  },
  uid: 1000,
  gid: 1000,
  inode: 7,
  sizeOnDisk: 4096,
  mimeType: 'text/plain',
  symlinkTarget: null,
  entryCount: null,
};

const file = () => new File(['hello world'], 'notes.txt', { type: 'text/plain' });

describe('FsTransferFeature', () => {
  let fs: FileSystemService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fs = TestBed.inject(FileSystemService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('downloadUrl()', () => {
    it('composes the download URL off the base path', () => {
      expect(fs.transferFt.downloadUrl('docs/prd/001.md')).toBe('/api/fs/download?path=docs/prd/001.md');
    });

    it('encodes the path exactly once', () => {
      expect(fs.transferFt.downloadUrl('my docs/a&b')).toBe('/api/fs/download?path=my%20docs/a%26b');
    });

    it('addresses the root with an empty path', () => {
      expect(fs.transferFt.downloadUrl('')).toBe('/api/fs/download?path=');
    });
  });

  describe('download()', () => {
    it('GETs the download URL as a blob and resolves with the bytes', async () => {
      const pending = fs.transferFt.download('docs/notes.txt');

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/download'));
      expect(request.request.method).toBe('GET');
      expect(request.request.url).toBe('/api/fs/download?path=docs/notes.txt');
      expect(request.request.responseType).toBe('blob');

      const blob = new Blob(['hello world'], { type: 'text/plain' });
      request.flush(blob);

      await expect(pending).resolves.toBe(blob);
    });

    it('recovers the server error code from the blob error body', async () => {
      const pending = fs.transferFt.download('docs');

      // A `responseType: 'blob'` request gets its error body as a Blob too, so
      // the envelope is read out of those bytes rather than being thrown away.
      http.expectOne((candidate) => candidate.url.startsWith('/api/fs/download')).flush(
        new Blob([JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Cannot download a directory' } })], {
          type: 'application/json',
        }),
        { status: 400, statusText: 'Bad Request' },
      );

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).status).toBe(400);
      expect((error as FsError).code).toBe('BAD_REQUEST');
      expect((error as FsError).message).toBe('Cannot download a directory');
    });

    it('falls back to the status when the blob body is not the contract envelope', async () => {
      const pending = fs.transferFt.download('docs/notes.txt');

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/download'))
        .flush(new Blob(['<html>gateway error</html>'], { type: 'text/html' }), {
          status: 502,
          statusText: 'Bad Gateway',
        });

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).status).toBe(502);
      expect((error as FsError).code).toBe('UNKNOWN_ERROR');
      expect((error as FsError).message).toBe('Bad Gateway (HTTP 502)');
    });

    it('rejects with an FsError on a network failure', async () => {
      const pending = fs.transferFt.download('docs/notes.txt');

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/download'))
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).code).toBe('NETWORK_ERROR');
    });
  });

  describe('upload()', () => {
    it('POSTs FormData to the upload URL with the directory and overwrite params', async () => {
      const upload = fs.transferFt.upload('docs', file(), { overwrite: true });

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'));
      expect(request.request.method).toBe('POST');
      expect(request.request.url).toBe('/api/fs/upload?path=docs&overwrite=true');
      expect(request.request.reportProgress).toBe(true);

      const body = request.request.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      const part = body.get('file');
      expect(part).toBeInstanceOf(File);
      expect((part as File).name).toBe('notes.txt');

      request.flush({ data: UPLOADED });
      await expect(upload.result).resolves.toEqual(UPLOADED);
    });

    it('defaults overwrite to false when no options are given', async () => {
      const upload = fs.transferFt.upload('docs', file());

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'));
      expect(request.request.url).toBe('/api/fs/upload?path=docs&overwrite=false');

      request.flush({ data: UPLOADED });
      await upload.result;
    });

    it('reports progress from upload-progress events', async () => {
      const upload = fs.transferFt.upload('docs', file());
      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'));

      expect(upload.progress()).toEqual({ loaded: 0, total: null, percent: null });

      request.event({ type: HttpEventType.UploadProgress, loaded: 256, total: 1024 });
      expect(upload.progress()).toEqual({ loaded: 256, total: 1024, percent: 25 });

      // No content length: `total` and `percent` stay indeterminate.
      request.event({ type: HttpEventType.UploadProgress, loaded: 512 });
      expect(upload.progress()).toEqual({ loaded: 512, total: null, percent: null });

      request.flush({ data: UPLOADED });
      await upload.result;
    });

    it('rejects with an FsError when the target exists and overwrite is off', async () => {
      const upload = fs.transferFt.upload('docs', file());

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'))
        .flush({ error: { code: 'CONFLICT', message: 'Already exists' } }, { status: 409, statusText: 'Conflict' });

      const error = await upload.result.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).code).toBe('CONFLICT');
      expect((error as FsError).status).toBe(409);
    });

    it('cancel() aborts the request and rejects the result', async () => {
      const upload = fs.transferFt.upload('docs', file());
      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/upload'));

      upload.cancel();

      expect(request.cancelled).toBe(true);
      const error = await upload.result.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).code).toBe('ABORTED');
    });

    it('keeps concurrent uploads independent', async () => {
      const first = fs.transferFt.upload('docs', file());
      const second = fs.transferFt.upload('other', file());

      const requests = http.match((candidate) => candidate.url.startsWith('/api/fs/upload'));
      expect(requests.length).toBe(2);
      expect(requests[0].request.url).toBe('/api/fs/upload?path=docs&overwrite=false');
      expect(requests[1].request.url).toBe('/api/fs/upload?path=other&overwrite=false');

      requests[0].event({ type: HttpEventType.UploadProgress, loaded: 10, total: 100 });
      expect(first.progress().percent).toBe(10);
      expect(second.progress().percent).toBeNull();

      requests[0].flush({ data: UPLOADED });
      requests[1].flush({ data: UPLOADED });
      await Promise.all([first.result, second.result]);
    });
  });
});
