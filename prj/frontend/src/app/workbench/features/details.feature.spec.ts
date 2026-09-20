import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  detailsUrl,
  downloadUrl,
  fsDetails,
  fsDirectoryDetails,
  fsEnvelope,
  fsErrorBody,
  settled,
} from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';

describe('DetailsFeature', () => {
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

  /** Selects a path and answers the details request it triggers. */
  const selectAndFlush = async (path: string, details = fsDetails(path)): Promise<void> => {
    workbench.select(path);
    http.expectOne(detailsUrl(path)).flush(fsEnvelope(details));
    await settled();
  };

  const valueOf = (label: string): string | undefined =>
    workbench.detailsFt.properties().find((property) => property.label === label)?.value;

  it('asks for the selected entry once and reports while it is in flight', async () => {
    workbench.select('README.md');
    const request = http.expectOne(detailsUrl('README.md'));

    expect(workbench.detailsFt.loading()).toBe(true);
    expect(workbench.detailsFt.hasDetails()).toBe(false);

    request.flush(fsEnvelope(fsDetails('README.md')));
    await settled();

    expect(workbench.detailsFt.loading()).toBe(false);
    expect(workbench.detailsFt.hasDetails()).toBe(true);
  });

  describe('preview', () => {
    it('describes a file by its type and size', async () => {
      await selectAndFlush('docs/notes.md', fsDetails('docs/notes.md', { size: 2048 }));

      expect(workbench.detailsFt.preview()).toMatchObject({
        title: 'notes.md',
        subtitle: 'MD · 2.0 KB',
        icon: 'file',
        tint: 'md',
      });
    });

    it('describes a directory by its entry count, and names the root', async () => {
      await selectAndFlush('', fsDirectoryDetails('', { entryCount: 4 }));

      expect(workbench.detailsFt.preview()).toMatchObject({
        title: workbench.mockWorkbench.workspaceName,
        subtitle: 'Folder · 4 items',
        icon: 'folder',
      });
    });
  });

  describe('properties', () => {
    it('formats what the backend reports', async () => {
      await selectAndFlush(
        'docs/prd/001.md',
        fsDetails('docs/prd/001.md', {
          size: 1126,
          sizeOnDisk: 4096,
          modifiedAt: '2026-09-20T13:11:00.000Z',
          uid: 1000,
          gid: 1000,
          inode: 4_718_902,
          mimeType: 'text/markdown',
        }),
      );

      expect(valueOf('Location')).toBe('/docs/prd');
      expect(valueOf('Size')).toBe('1,126 bytes (1.1 KB)');
      expect(valueOf('On disk')).toBe('4.0 KB');
      expect(valueOf('Modified')).toBe('Sep 20, 2026 13:11');
      expect(valueOf('Owner')).toBe('1000 : 1000');
      expect(valueOf('Inode')).toBe('4718902');
      expect(valueOf('Media type')).toBe('text/markdown');
      expect(valueOf('Entries')).toBeUndefined();
    });

    it('omits the optional rows the backend left empty', async () => {
      await selectAndFlush('blob.bin', fsDetails('blob.bin', { mimeType: null, symlinkTarget: null }));

      expect(valueOf('Media type')).toBeUndefined();
      expect(valueOf('Links to')).toBeUndefined();
    });

    it('adds the entry count for a directory and the target for a symlink', async () => {
      await selectAndFlush('docs', fsDirectoryDetails('docs', { entryCount: 1 }));
      expect(valueOf('Entries')).toBe('1 item');

      workbench.select('link');
      http
        .expectOne(detailsUrl('link'))
        .flush(fsEnvelope(fsDetails('link', { type: 'symlink', symlinkTarget: 'docs/prd' })));
      await settled();

      expect(valueOf('Links to')).toBe('docs/prd');
    });

    it('says so when a directory could not be counted', async () => {
      await selectAndFlush('locked', fsDirectoryDetails('locked', { entryCount: null }));

      expect(valueOf('Entries')).toBe('unreadable');
    });
  });

  describe('permissions', () => {
    it('passes the backend matrix through with its octal mode', async () => {
      await selectAndFlush(
        'README.md',
        fsDetails('README.md', {
          mode: '0644',
          permissions: {
            owner: { read: true, write: true, execute: false },
            group: { read: true, write: false, execute: false },
            others: { read: true, write: false, execute: false },
          },
        }),
      );

      expect(workbench.detailsFt.permissions()).toEqual({
        mode: '0644',
        owner: { read: true, write: true, execute: false },
        group: { read: true, write: false, execute: false },
        others: { read: true, write: false, execute: false },
      });
    });
  });

  describe('actions', () => {
    it('offers a download for a file', async () => {
      await selectAndFlush('README.md');

      expect(workbench.detailsFt.actions().map((action) => action.id)).toEqual([
        'download',
        'copy-path',
        'refresh',
      ]);
    });

    it('offers opening and uploading for a directory', async () => {
      await selectAndFlush('docs', fsDirectoryDetails('docs'));

      expect(workbench.detailsFt.actions().map((action) => action.id)).toEqual([
        'open',
        'upload',
        'copy-path',
        'refresh',
      ]);
    });

    it('re-reads the entry on refresh', async () => {
      await selectAndFlush('README.md');

      workbench.detailsFt.runAction('refresh');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md', { size: 99 })));
      await settled();

      expect(workbench.detailsFt.preview()?.subtitle).toBe('MD · 99 B');
    });

    it('asks the workbench for a file picker when uploading into a directory', async () => {
      await selectAndFlush('docs', fsDirectoryDetails('docs'));

      workbench.detailsFt.runAction('upload');

      expect(workbench.uploadRequest()).toEqual({
        groupId: workbench.activeGroupId(),
        path: 'docs',
      });
    });

    it('hands the file URL to the browser on download', async () => {
      await selectAndFlush('docs/notes.md');
      const hrefs: (string | null)[] = [];
      const names: (string | null)[] = [];
      const create = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = create(tag);
        if (tag === 'a') {
          element.click = () => {
            hrefs.push(element.getAttribute('href'));
            names.push(element.getAttribute('download'));
          };
        }
        return element;
      }) as typeof document.createElement);

      workbench.detailsFt.runAction('download');
      // The transport resolves the URL, so the anchor is clicked a microtask
      // later; see `TransfersFeature.download` (PRD 001, §8.1).
      await settled();

      // A download is a browser transfer, not an `HttpClient` request.
      expect(hrefs).toEqual([downloadUrl('docs/notes.md')]);
      expect(names).toEqual(['notes.md']);
      http.expectNone(() => true);
    });

    it('copies the entry path to the clipboard', async () => {
      await selectAndFlush('docs/prd/001.md');
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      workbench.detailsFt.runAction('copy-path');

      expect(writeText).toHaveBeenCalledWith('docs/prd/001.md');
    });

    it('ignores an unknown action', async () => {
      await selectAndFlush('README.md');

      expect(() => workbench.detailsFt.runAction('nope')).not.toThrow();
    });
  });

  describe('failures', () => {
    it('surfaces the server message and shows nothing else', async () => {
      workbench.select('gone.txt');
      http
        .expectOne(detailsUrl('gone.txt'))
        .flush(fsErrorBody('NOT_FOUND', 'Path not found: gone.txt'), {
          status: 404,
          statusText: 'Not Found',
        });
      await settled();

      expect(workbench.detailsFt.error()).toBe('Path not found: gone.txt');
      expect(workbench.detailsFt.hasDetails()).toBe(false);
      expect(workbench.detailsFt.properties()).toEqual([]);
      expect(workbench.detailsFt.permissions()).toBeUndefined();
      expect(workbench.detailsFt.actions()).toEqual([]);
    });
  });
});
