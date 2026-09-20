import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FileSystemService } from '../file-system.service';
import { FsHttpService } from '../fs-http.service';
import type { FsDetails, FsDirectoryListing } from '../file-system.model';
import { FsError } from '../fs-error';

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

const DETAILS: FsDetails = {
  name: '001.md',
  path: 'docs/prd/001.md',
  type: 'file',
  size: 1234,
  hidden: false,
  modifiedAt: '2026-01-02T03:04:05.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  parent: 'docs/prd',
  accessedAt: '2026-01-03T00:00:00.000Z',
  changedAt: '2026-01-02T03:04:05.000Z',
  mode: '0644',
  permissions: {
    owner: { read: true, write: true, execute: false },
    group: { read: true, write: false, execute: false },
    others: { read: true, write: false, execute: false },
  },
  uid: 1000,
  gid: 1000,
  inode: 42,
  sizeOnDisk: 2048,
  mimeType: 'text/markdown',
  symlinkTarget: null,
  entryCount: null,
};

describe('FsReadFeature', () => {
  let fs: FileSystemService;
  let httpFs: FsHttpService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fs = TestBed.inject(FileSystemService);
    // The reactive readers moved onto the HTTP transport with §8.1 — an
    // `httpResource` cannot exist on a transport that speaks no HTTP.
    httpFs = TestBed.inject(FsHttpService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('list()', () => {
    it('GETs /api/fs/list with the path param and unwraps the envelope', async () => {
      const pending = fs.readFt.list('docs');

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/list'));
      expect(request.request.method).toBe('GET');
      expect(request.request.urlWithParams).toBe('/api/fs/list?path=docs');
      request.flush({ data: LISTING });

      await expect(pending).resolves.toEqual(LISTING);
    });

    it('encodes an awkward path exactly once', async () => {
      const pending = fs.readFt.list('my docs/a&b#c');

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/list'));
      // `HttpParams` encodes the value; `HttpClient` must not encode it again.
      expect(request.request.url).toBe('/api/fs/list?path=my%20docs/a%26b%23c');
      request.flush({ data: LISTING });

      await pending;
    });

    it('lists the root as an empty path', async () => {
      const pending = fs.readFt.list('');

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/list'));
      expect(request.request.url).toBe('/api/fs/list?path=');
      request.flush({ data: LISTING });

      await pending;
    });

    it('rejects with an FsError carrying the server code and status', async () => {
      const pending = fs.readFt.list('nope');

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/list'))
        .flush(
          { error: { code: 'NOT_FOUND', message: 'No such path', details: { path: 'nope' } } },
          { status: 404, statusText: 'Not Found' },
        );

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      const fsError = error as FsError;
      expect(fsError.code).toBe('NOT_FOUND');
      expect(fsError.status).toBe(404);
      expect(fsError.message).toBe('No such path');
      expect(fsError.details).toEqual({ path: 'nope' });
    });

    it('rejects with an FsError when the request never reaches the server', async () => {
      const pending = fs.readFt.list('docs');

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/list'))
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).status).toBe(0);
      expect((error as FsError).code).toBe('NETWORK_ERROR');
      expect((error as FsError).message).toContain('Could not reach the server');
    });

    it('rejects with an FsError when the body is not the contract envelope', async () => {
      const pending = fs.readFt.list('docs');

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/list'))
        .flush('<html>boom</html>', { status: 500, statusText: 'Internal Server Error' });

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).status).toBe(500);
      expect((error as FsError).code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('details()', () => {
    it('GETs /api/fs/details with the path param and unwraps the envelope', async () => {
      const pending = fs.readFt.details('docs/prd/001.md');

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/details'));
      expect(request.request.method).toBe('GET');
      expect(request.request.url).toBe('/api/fs/details?path=docs/prd/001.md');
      request.flush({ data: DETAILS });

      await expect(pending).resolves.toEqual(DETAILS);
    });

    it('surfaces a FORBIDDEN response as an FsError', async () => {
      const pending = fs.readFt.details('../../etc/passwd');

      http
        .expectOne((candidate) => candidate.url.startsWith('/api/fs/details'))
        .flush({ error: { code: 'FORBIDDEN', message: 'Outside the root' } }, { status: 403, statusText: 'Forbidden' });

      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).code).toBe('FORBIDDEN');
      expect((error as FsError).status).toBe(403);
      expect((error as FsError).details).toBeUndefined();
    });
  });

  describe('listResource()', () => {
    it('issues no request while the path signal is undefined', () => {
      const path = signal<string | undefined>(undefined);
      httpFs.listResource(path);
      TestBed.tick();

      http.expectNone(() => true);
    });

    it('requests the right URL once the path signal has a value', () => {
      const path = signal<string | undefined>(undefined);
      httpFs.listResource(path);
      TestBed.tick();

      path.set('docs');
      TestBed.tick();

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/list'));
      expect(request.request.url).toBe('/api/fs/list?path=docs');
      request.flush({ data: LISTING });
    });
  });

  describe('detailsResource()', () => {
    it('issues no request while the path signal is undefined', () => {
      const path = signal<string | undefined>(undefined);
      httpFs.detailsResource(path);
      TestBed.tick();

      http.expectNone(() => true);
    });

    it('requests the right URL once the path signal has a value', () => {
      const path = signal<string | undefined>('docs/prd/001.md');
      httpFs.detailsResource(path);
      TestBed.tick();

      const request = http.expectOne((candidate) => candidate.url.startsWith('/api/fs/details'));
      expect(request.request.url).toBe('/api/fs/details?path=docs/prd/001.md');
      request.flush({ data: DETAILS });
    });
  });
});
