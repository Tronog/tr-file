import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiTransfer } from '@tr-file/ui';
import {
  downloadUrl,
  fsDetails,
  fsEntry,
  fsEnvelope,
  fsErrorBody,
  fsListing,
  listUrl,
  settled,
  uploadUrl,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

const file = (name = 'notes.txt') => new File(['hello world'], name, { type: 'text/plain' });

describe('TransfersFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    http.verify();
  });

  const rows = (): readonly UiTransfer[] => workbench.transfersFt.rows();

  it('starts with nothing to report', () => {
    expect(rows()).toEqual([]);
    expect(workbench.transfersFt.activeCount()).toBe(0);
    expect(workbench.transfersFt.hasFinished()).toBe(false);
  });

  describe('uploadFiles()', () => {
    it('starts one upload per file, newest row first', () => {
      workbench.transfersFt.uploadFiles('docs', [file('a.txt'), file('b.txt')]);

      const requests = http.match((candidate) => candidate.url.startsWith('/api/fs/upload'));
      expect(requests).toHaveLength(2);
      expect(requests[0].request.url).toBe(uploadUrl('docs'));
      expect(rows().map((row) => row.name)).toEqual(['b.txt → docs', 'a.txt → docs']);
      expect(workbench.transfersFt.activeCount()).toBe(2);
    });

    it('reports the percentage from upload-progress events', () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);
      const request = http.expectOne(uploadUrl('docs'));

      expect(rows()[0]).toMatchObject({
        id: 'upload-1',
        name: 'notes.txt → docs',
        icon: 'upload',
        progress: null,
        statusLabel: 'uploading…',
      });

      request.event({ type: HttpEventType.UploadProgress, loaded: 2048, total: 8192 });

      expect(rows()[0]).toMatchObject({ progress: 25, statusLabel: '25% · 2.0 KB' });
    });

    it('names the workspace root as / in the row label', () => {
      workbench.transfersFt.uploadFiles('', [file()]);
      http.expectOne(uploadUrl(''));

      expect(rows()[0]?.name).toBe('notes.txt → /');
    });
  });

  describe('a completed upload', () => {
    it('reports the stored size and re-reads its directory', async () => {
      // The directory has to be on screen for the invalidation to do anything.
      workbench.fsDataFt.ensureListing('docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs')));
      await settled();

      workbench.transfersFt.uploadFiles('docs', [file()]);
      http.expectOne(uploadUrl('docs')).flush(fsEnvelope(fsDetails('docs/notes.txt', { size: 11 })));
      await settled();

      expect(rows()[0]).toMatchObject({
        icon: 'check',
        progress: 100,
        statusLabel: 'done · 11 B',
      });
      expect(workbench.transfersFt.activeCount()).toBe(0);
      expect(workbench.transfersFt.hasFinished()).toBe(true);

      // The listing was re-requested, so every panel showing it picks the file up.
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [fsEntry('docs/notes.txt')])));
      await settled();

      expect(workbench.fsDataFt.entries('docs').map((entry) => entry.name)).toEqual(['notes.txt']);
    });

    it('leaves a directory nobody is showing alone', async () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);
      http.expectOne(uploadUrl('docs')).flush(fsEnvelope(fsDetails('docs/notes.txt', { size: 11 })));
      await settled();

      http.expectNone(listUrl('docs'));
    });
  });

  describe('a failed upload', () => {
    it('says "already exists" when the file is there and overwrite is off', async () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);

      http
        .expectOne(uploadUrl('docs'))
        .flush(fsErrorBody('CONFLICT', 'Already exists'), { status: 409, statusText: 'Conflict' });
      await settled();

      expect(rows()[0]).toMatchObject({
        icon: 'alert-triangle',
        progress: 100,
        statusLabel: 'already exists',
      });
      expect(workbench.transfersFt.activeCount()).toBe(0);
    });

    it('says "failed" for anything else', async () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);

      http
        .expectOne(uploadUrl('docs'))
        .flush(fsErrorBody('BAD_REQUEST', 'Not a directory'), { status: 400, statusText: 'Bad Request' });
      await settled();

      expect(rows()[0]?.statusLabel).toBe('failed');
    });
  });

  describe('cancel()', () => {
    it('aborts the request and marks the row cancelled', async () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);
      const request = http.expectOne(uploadUrl('docs'));

      workbench.transfersFt.cancel('upload-1');
      await settled();

      expect(request.cancelled).toBe(true);
      expect(rows()[0]).toMatchObject({ icon: 'x', progress: 100, statusLabel: 'cancelled' });
      expect(workbench.transfersFt.activeCount()).toBe(0);
    });

    it('ignores an id it does not know', () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);
      http.expectOne(uploadUrl('docs'));

      workbench.transfersFt.cancel('upload-99');

      expect(rows()[0]?.statusLabel).toBe('uploading…');
    });
  });

  describe('clearFinished()', () => {
    it('keeps only the uploads that are still running', async () => {
      workbench.transfersFt.uploadFiles('docs', [file('done.txt'), file('running.txt')]);
      const requests = http.match(uploadUrl('docs'));
      requests[0].flush(fsEnvelope(fsDetails('docs/done.txt', { size: 11 })));
      await settled();

      expect(rows()).toHaveLength(2);

      workbench.transfersFt.clearFinished();

      expect(rows().map((row) => row.name)).toEqual(['running.txt → docs']);
      expect(workbench.transfersFt.hasFinished()).toBe(false);
      requests[1].flush(fsEnvelope(fsDetails('docs/running.txt', { size: 11 })));
      await settled();
    });
  });

  describe('download()', () => {
    it('hands the browser a download link and tracks nothing', () => {
      const hrefs: (string | null)[] = [];
      const create = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = create(tag);
        if (tag === 'a') {
          element.click = () => hrefs.push(element.getAttribute('href'));
        }
        return element;
      }) as typeof document.createElement);

      workbench.transfersFt.download('docs/notes.txt', 'notes.txt');

      expect(hrefs).toEqual([downloadUrl('docs/notes.txt')]);
      expect(rows()).toEqual([]);
      http.expectNone(() => true);
    });
  });
});
