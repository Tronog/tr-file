import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  detailsUrl,
  fsDetails,
  fsDirectory,
  fsEntry,
  fsEnvelope,
  fsErrorBody,
  fsListing,
  listUrl,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

describe('FsDataFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Answers the pending listing for `path` and lets the cache settle. */
  const flushListing = async (path: string, entries = [fsEntry(`${path}/a.ts`)]): Promise<void> => {
    http.expectOne(listUrl(path)).flush(fsEnvelope(fsListing(path, entries)));
    await settled();
  };

  describe('ensureListing', () => {
    it('fetches a directory once and serves the cache afterwards', async () => {
      workbench.fsDataFt.ensureListing('docs');
      await flushListing('docs');

      expect(workbench.fsDataFt.listingState('docs')?.status).toBe('ready');
      expect(workbench.fsDataFt.entries('docs').map((entry) => entry.path)).toEqual(['docs/a.ts']);

      workbench.fsDataFt.ensureListing('docs');

      http.expectNone(listUrl('docs'));
    });

    it('is a no-op while the same path is already in flight', async () => {
      workbench.fsDataFt.ensureListing('docs');
      workbench.fsDataFt.ensureListing('docs');

      expect(http.match(listUrl('docs'))).toHaveLength(1);
      expect(workbench.fsDataFt.listingState('docs')?.status).toBe('loading');
      await settled();
    });

    it('reports nothing at all for a path that was never asked for', () => {
      expect(workbench.fsDataFt.listingState('nope')).toBeUndefined();
      expect(workbench.fsDataFt.entries('nope')).toEqual([]);
    });
  });

  describe('reloadListing', () => {
    it('re-fetches a cached directory and replaces its entries', async () => {
      workbench.fsDataFt.ensureListing('docs');
      await flushListing('docs');

      workbench.fsDataFt.reloadListing('docs');
      await flushListing('docs', [fsEntry('docs/b.md'), fsEntry('docs/c.md')]);

      expect(workbench.fsDataFt.entries('docs').map((entry) => entry.name)).toEqual(['b.md', 'c.md']);
    });

    it('does not stack a second request on top of one in flight', async () => {
      workbench.fsDataFt.ensureListing('docs');
      workbench.fsDataFt.reloadListing('docs');

      expect(http.match(listUrl('docs'))).toHaveLength(1);
      await settled();
    });
  });

  describe('invalidateListing', () => {
    it('re-reads a directory that is cached', async () => {
      workbench.fsDataFt.ensureListing('docs');
      await flushListing('docs');

      workbench.fsDataFt.invalidateListing('docs');

      expect(http.match(listUrl('docs'))).toHaveLength(1);
      await settled();
    });

    it('leaves a directory nobody is showing alone', () => {
      workbench.fsDataFt.invalidateListing('docs');

      http.expectNone(() => true);
      expect(workbench.fsDataFt.listingState('docs')).toBeUndefined();
    });
  });

  describe('a failed listing', () => {
    it('lands in the path state and shows up in errors()', async () => {
      workbench.fsDataFt.ensureListing('secret');

      http
        .expectOne(listUrl('secret'))
        .flush(fsErrorBody('FORBIDDEN', 'Outside the root'), { status: 403, statusText: 'Forbidden' });
      await settled();

      const state = workbench.fsDataFt.listingState('secret');
      expect(state?.status).toBe('error');
      expect(state?.error?.code).toBe('FORBIDDEN');
      expect(state?.error?.message).toBe('Outside the root');
      expect(state?.listing).toBeUndefined();
      expect(workbench.fsDataFt.entries('secret')).toEqual([]);

      expect(workbench.fsDataFt.errors()).toEqual([
        { path: 'secret', error: state?.error },
      ]);
    });

    it('leaves errors() empty while everything reads cleanly', async () => {
      workbench.fsDataFt.ensureListing('docs');
      await flushListing('docs');

      expect(workbench.fsDataFt.errors()).toEqual([]);
    });

    it('is retried by simply asking again, not only by an explicit reload', async () => {
      workbench.fsDataFt.ensureListing('docs');
      http
        .expectOne(listUrl('docs'))
        .flush(fsErrorBody('FORBIDDEN', 'Permission denied: docs'), {
          status: 403,
          statusText: 'Forbidden',
        });
      await settled();

      // Re-expanding the folder (or opening it in another panel) asks again:
      // a cached failure must not be mistaken for a cached answer.
      workbench.fsDataFt.ensureListing('docs');
      await flushListing('docs');

      expect(workbench.fsDataFt.listingState('docs')?.status).toBe('ready');
      expect(workbench.fsDataFt.errors()).toEqual([]);
    });

    it('can be retried, which clears the problem', async () => {
      workbench.fsDataFt.ensureListing('docs');
      http
        .expectOne(listUrl('docs'))
        .flush(fsErrorBody('NOT_FOUND', 'No such path'), { status: 404, statusText: 'Not Found' });
      await settled();

      expect(workbench.fsDataFt.errors()).toHaveLength(1);

      workbench.fsDataFt.reloadListing('docs');
      await flushListing('docs');

      expect(workbench.fsDataFt.errors()).toEqual([]);
      expect(workbench.fsDataFt.listingState('docs')?.status).toBe('ready');
    });
  });

  describe('entries()', () => {
    const hiddenListing = async (): Promise<void> => {
      workbench.fsDataFt.ensureListing('');
      http.expectOne(listUrl('')).flush(
        fsEnvelope(
          fsListing('', [
            fsDirectory('.git'),
            fsDirectory('docs'),
            fsEntry('.gitignore'),
            fsEntry('README.md'),
          ]),
        ),
      );
      await settled();
    };

    it('filters hidden entries out by default', async () => {
      await hiddenListing();

      expect(workbench.fsDataFt.entries('').map((entry) => entry.name)).toEqual(['docs', 'README.md']);
    });

    it('keeps them once the workbench is showing hidden files', async () => {
      await hiddenListing();

      workbench.showHidden.set(true);

      expect(workbench.fsDataFt.entries('').map((entry) => entry.name)).toEqual([
        '.git',
        'docs',
        '.gitignore',
        'README.md',
      ]);
    });

    it('is empty while the listing is still loading', () => {
      workbench.fsDataFt.ensureListing('docs');

      expect(workbench.fsDataFt.entries('docs')).toEqual([]);
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs')));
    });
  });

  describe('details', () => {
    it('fetches an entry once and serves the cache afterwards', async () => {
      workbench.fsDataFt.ensureDetails('docs/a.ts');

      expect(workbench.fsDataFt.detailsState('docs/a.ts')?.status).toBe('loading');

      http.expectOne(detailsUrl('docs/a.ts')).flush(fsEnvelope(fsDetails('docs/a.ts', { size: 2048 })));
      await settled();

      expect(workbench.fsDataFt.detailsState('docs/a.ts')?.details?.size).toBe(2048);

      workbench.fsDataFt.ensureDetails('docs/a.ts');

      http.expectNone(detailsUrl('docs/a.ts'));
    });

    it('is a no-op while the same path is already in flight', async () => {
      workbench.fsDataFt.ensureDetails('docs/a.ts');
      workbench.fsDataFt.ensureDetails('docs/a.ts');

      expect(http.match(detailsUrl('docs/a.ts'))).toHaveLength(1);
      await settled();
    });

    it('reloadDetails re-fetches a cached entry', async () => {
      workbench.fsDataFt.ensureDetails('docs/a.ts');
      http.expectOne(detailsUrl('docs/a.ts')).flush(fsEnvelope(fsDetails('docs/a.ts', { size: 1 })));
      await settled();

      workbench.fsDataFt.reloadDetails('docs/a.ts');
      http.expectOne(detailsUrl('docs/a.ts')).flush(fsEnvelope(fsDetails('docs/a.ts', { size: 99 })));
      await settled();

      expect(workbench.fsDataFt.detailsState('docs/a.ts')?.details?.size).toBe(99);
    });

    it('records a failure as the error state of that path', async () => {
      workbench.fsDataFt.ensureDetails('gone.txt');

      http
        .expectOne(detailsUrl('gone.txt'))
        .flush(fsErrorBody('NOT_FOUND', 'No such path'), { status: 404, statusText: 'Not Found' });
      await settled();

      const state = workbench.fsDataFt.detailsState('gone.txt');
      expect(state?.status).toBe('error');
      expect(state?.error?.code).toBe('NOT_FOUND');
      expect(state?.details).toBeUndefined();
      // Only listings feed the Problems panel; a failed detail is shown in the
      // sidebar that asked for it.
      expect(workbench.fsDataFt.errors()).toEqual([]);
    });

    it('retries a failed entry when it is selected again', async () => {
      workbench.fsDataFt.ensureDetails('gone.txt');
      http
        .expectOne(detailsUrl('gone.txt'))
        .flush(fsErrorBody('NOT_FOUND', 'Path not found: gone.txt'), {
          status: 404,
          statusText: 'Not Found',
        });
      await settled();

      workbench.fsDataFt.ensureDetails('gone.txt');
      http.expectOne(detailsUrl('gone.txt')).flush(fsEnvelope(fsDetails('gone.txt')));
      await settled();

      expect(workbench.fsDataFt.detailsState('gone.txt')?.status).toBe('ready');
    });

    it('reports nothing at all for an entry that was never asked for', () => {
      expect(workbench.fsDataFt.detailsState('nope')).toBeUndefined();
    });
  });
});
