import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { UiTransfer } from '@tr-file/file-ui';
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

  /** PRD 002, §3 — a name that is taken is a question, asked in a modal dialog. */
  describe('a name that is already taken', () => {
    /** Answers every upload in flight to `directory` with "already exists". */
    const conflict = (directory = 'docs'): void => {
      for (const request of http.match(uploadUrl(directory))) {
        request.flush(fsErrorBody('CONFLICT', 'Already exists'), { status: 409, statusText: 'Conflict' });
      }
    };

    const dialog = () => workbench.modal.stack().at(-1);
    const answer = (buttonId: string, checked = false): void => {
      const top = dialog();
      if (top?.kind === 'dialog') {
        workbench.modal.choose(top.id, { buttonId, checked, value: '' });
      }
    };

    it('asks whether to replace it, keeping the row running meanwhile', async () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);
      conflict();
      await settled();

      const top = dialog();
      expect(top?.kind).toBe('dialog');
      expect(top?.kind === 'dialog' && top.model()).toMatchObject({
        severity: 'warning',
        message: "A file named 'notes.txt' already exists in 'docs'. Do you want to replace it?",
        buttons: [
          { id: 'replace', label: 'Replace' },
          { id: 'skip', label: 'Skip' },
        ],
      });
      // One file, so there is nothing for "all" to mean.
      expect(top?.kind === 'dialog' && top.model().checkbox).toBeUndefined();
      expect(workbench.transfersFt.activeCount()).toBe(1);
    });

    it('sends it again with overwrite when told to replace it', async () => {
      workbench.transfersFt.uploadFiles('docs', [file()]);
      conflict();
      await settled();

      answer('replace');
      await settled();

      const retry = http.expectOne(uploadUrl('docs', true));
      retry.flush(fsEnvelope(fsDetails('docs/notes.txt', { size: 11 })));
      await settled();

      expect(rows()[0]).toMatchObject({ icon: 'check', statusLabel: 'done · 11 B' });
      expect(workbench.modal.isOpen()).toBe(false);
    });

    it('skips it when told to, or when the dialog is closed', async () => {
      workbench.transfersFt.uploadFiles('docs', [file('a.txt'), file('b.txt')]);
      conflict();
      await settled();

      answer('skip');
      await settled();
      // The second question waited for the first.
      const second = dialog();
      expect(second?.kind === 'dialog' && second.model().message).toContain("'b.txt'");
      workbench.modal.dismiss(second?.id ?? -1);
      await settled();

      expect(rows().map((row) => row.statusLabel)).toEqual(['skipped · already exists', 'skipped · already exists']);
      http.expectNone(uploadUrl('docs', true));
    });

    it('answers every later conflict in the batch the same way, once asked to', async () => {
      workbench.transfersFt.uploadFiles('docs', [file('a.txt'), file('b.txt'), file('c.txt')]);
      conflict();
      await settled();

      const first = dialog();
      expect(first?.kind === 'dialog' && first.model().checkbox?.label).toBe('Do this for all remaining conflicts');
      answer('replace', true);
      await settled();

      expect(workbench.modal.isOpen()).toBe(false);
      const retries = http.match(uploadUrl('docs', true));
      expect(retries).toHaveLength(3);
      for (const retry of retries) {
        retry.flush(fsEnvelope(fsDetails('docs/x.txt', { size: 1 })));
      }
      await settled();
    });
  });

  describe('a failed upload', () => {
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

  /** PRD 003, §1: downloads are rows too, so a failure is seen, not logged. */
  describe('download()', () => {
    let hrefs: (string | null)[];

    beforeEach(() => {
      hrefs = [];
      const create = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = create(tag);
        if (tag === 'a') {
          element.click = () => hrefs.push(element.getAttribute('href'));
        }
        return element;
      }) as typeof document.createElement);
    });

    it('checks the file is there, then hands the browser the link, as a row', async () => {
      workbench.transfersFt.download('docs/notes.txt', 'notes.txt');

      expect(rows()[0]).toMatchObject({ icon: 'download', statusLabel: 'starting…', progress: null });
      expect(workbench.transfersFt.activeCount()).toBe(1);

      http.expectOne(downloadUrl('docs/notes.txt')).flush(new Blob(['n']));
      await settled();

      expect(hrefs).toEqual([downloadUrl('docs/notes.txt')]);
      expect(rows()[0]).toMatchObject({ name: 'notes.txt ← docs/notes.txt', icon: 'check', statusLabel: 'sent to browser' });
      expect(workbench.transfersFt.activeCount()).toBe(0);
    });

    it('shows why the server refused, and hands the browser nothing', async () => {
      workbench.transfersFt.download('docs/secret.txt', 'secret.txt');

      http
        .expectOne(downloadUrl('docs/secret.txt'))
        .flush(new Blob([JSON.stringify(fsErrorBody('FORBIDDEN', 'Permission denied: docs/secret.txt'))]), {
          status: 403,
          statusText: 'Forbidden',
        });
      await settled();

      expect(hrefs).toEqual([]);
      expect(rows()[0]).toMatchObject({ icon: 'alert-triangle', statusLabel: 'failed · permission denied' });
    });

    it('saves an empty file, which has no first byte to check', async () => {
      workbench.transfersFt.download('empty.txt', 'empty.txt');

      http.expectOne(downloadUrl('empty.txt')).flush(new Blob([]), { status: 416, statusText: 'Range Not Satisfiable' });
      await settled();

      expect(hrefs).toEqual([downloadUrl('empty.txt')]);
    });

    it('can be cancelled before the browser has it', async () => {
      workbench.transfersFt.download('docs/notes.txt', 'notes.txt');
      const check = http.expectOne(downloadUrl('docs/notes.txt'));

      workbench.transfersFt.cancel('download-1');
      await settled();

      expect(check.cancelled).toBe(true);
      expect(hrefs).toEqual([]);
      expect(rows()[0]).toMatchObject({ statusLabel: 'cancelled' });
    });
  });
});
