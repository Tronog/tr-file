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

  /** PRD 001, §9 — a selected image shows itself, not its type icon. */
  describe('the image preview', () => {
    let made: string[];
    let revoked: string[];

    beforeEach(() => {
      made = [];
      revoked = [];
      // jsdom has neither; record what the service is given.
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = `blob:preview/${made.length}/${(blob as Blob).size}`;
        made.push(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => void revoked.push(url);
    });

    /** Selects an image and answers the details and the picture. */
    const selectImage = async (path: string): Promise<void> => {
      workbench.select(path);
      http.expectOne(detailsUrl(path)).flush(fsEnvelope(fsDetails(path)));
      http.expectOne(downloadUrl(path)).flush(new Blob(['PNGDATA'], { type: 'image/png' }));
      await settled();
    };

    it('shows the file itself on the preview card', async () => {
      await selectImage('logo.png');

      expect(workbench.detailsFt.preview()).toMatchObject({
        title: 'logo.png',
        imageSrc: made[0],
      });
    });

    /** Anything that is not a picture keeps its type icon and asks for nothing. */
    it('leaves a text file alone', async () => {
      await selectAndFlush('README.md');

      expect(workbench.detailsFt.preview()?.imageSrc).toBeUndefined();
      http.expectNone(downloadUrl('README.md'));
    });

    it('leaves a directory alone', async () => {
      workbench.select('docs');
      http.expectOne(detailsUrl('docs')).flush(fsEnvelope(fsDirectoryDetails('docs')));
      await settled();

      expect(workbench.detailsFt.preview()?.imageSrc).toBeUndefined();
    });

    /** Until the bytes arrive there is nothing to draw but the icon. */
    it('shows the icon while the picture is still coming', async () => {
      workbench.select('logo.png');
      http.expectOne(detailsUrl('logo.png')).flush(fsEnvelope(fsDetails('logo.png')));
      await settled();

      expect(workbench.detailsFt.preview()?.imageSrc).toBeUndefined();
      expect(workbench.detailsFt.preview()?.icon).toBeDefined();

      http.expectOne(downloadUrl('logo.png')).flush(new Blob(['PNGDATA'], { type: 'image/png' }));
      await settled();

      expect(workbench.detailsFt.preview()?.imageSrc).toBe(made[0]);
    });

    /** A failed read is not an error the sidebar shows; the icon simply stays. */
    it('keeps the icon when the picture cannot be read', async () => {
      workbench.select('logo.png');
      http.expectOne(detailsUrl('logo.png')).flush(fsEnvelope(fsDetails('logo.png')));
      http
        .expectOne(downloadUrl('logo.png'))
        .flush(new Blob([JSON.stringify(fsErrorBody('NOT_FOUND', 'Gone'))]), {
          status: 404,
          statusText: 'Not Found',
        });
      await settled();

      expect(workbench.detailsFt.preview()?.imageSrc).toBeUndefined();
      expect(workbench.detailsFt.hasDetails()).toBe(true);
    });

    /** One cache: the panel and the sidebar do not fetch the same file twice. */
    it('reuses the picture the panel already read', async () => {
      await selectImage('logo.png');

      workbench.filePreviewFt.load('logo.png');
      await settled();

      // `load` finds it cached; only a `reload` would ask again.
      http.expectNone(downloadUrl('logo.png'));
      expect(workbench.images.urlFor('logo.png')).toBe(made[0]);
    });

    it('replaces the URL it holds when the picture is refreshed', async () => {
      await selectImage('logo.png');

      workbench.detailsFt.runAction('refresh');
      http.expectOne(detailsUrl('logo.png')).flush(fsEnvelope(fsDetails('logo.png')));
      http.expectOne(downloadUrl('logo.png')).flush(new Blob(['NEWER'], { type: 'image/png' }));
      await settled();

      expect(revoked).toEqual([made[0]]);
      expect(workbench.detailsFt.preview()?.imageSrc).toBe(made[1]);
    });
  });

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

  /** PRD 004, §3.1.3 — a large folder says `1000+ items` until that is clicked, which counts them all. */
  describe('a large folder\'s entries', () => {
    const entries = () => workbench.detailsFt.properties().find((property) => property.label === 'Entries');

    it('says 1000+, and counts them all when that is pressed — once, then again only by a refresh', async () => {
      await selectAndFlush('big', fsDirectoryDetails('big', { entryCount: 1000, entryCountMore: true }));
      expect(entries()).toMatchObject({ value: '1000+ items', action: 'count-entries' });
      expect(workbench.detailsFt.preview()?.subtitle).toContain('1000+ items');
      // A refresh does not count what was never counted.
      expect(workbench.detailsFt.recounts('big')).toBe(false);

      workbench.detailsFt.runAction('count-entries');
      await settled();
      expect(entries()).toEqual({ label: 'Entries', value: 'Counting…' });
      http.expectOne(`${detailsUrl('big')}&recount=1`).flush(fsEnvelope(fsDirectoryDetails('big', { entryCount: 1_234_567 })));
      await settled();
      expect(entries()).toEqual({ label: 'Entries', value: '1234567 items' });

      // Counted once: a refresh counts again.
      expect(workbench.detailsFt.recounts('big')).toBe(true);
      workbench.detailsFt.runAction('refresh');
      http.expectOne(`${detailsUrl('big')}&recount=1`).flush(fsEnvelope(fsDirectoryDetails('big', { entryCount: 1_234_568 })));
      await settled();
      expect(entries()?.value).toBe('1234568 items');
    });
  });

  /** PRD 001, §9.3.1 — a path in Details copies itself when pressed; the UNIX way with `Shift`. */
  describe('copying paths', () => {
    const property = (label: string) =>
      [...workbench.detailsFt.properties(), ...workbench.detailsFt.transferPaths()].find((candidate) => candidate.label === label);

    it('makes every path a value to copy, and nothing else', async () => {
      await selectAndFlush('link', fsDetails('link', { type: 'symlink', symlinkTarget: 'C:\\Users\\me' }));
      for (const label of ['Location', 'Links to', 'Source', 'Destination']) {
        expect(property(label)).toMatchObject({ copy: true, action: expect.stringMatching(/^copy-/) });
      }
      expect(property('Size')?.action).toBeUndefined();
      expect(property('Media type')?.action).toBeUndefined();
    });

    it('copies an entry’s folder as Copy Path does, and says so for a moment', async () => {
      vi.useFakeTimers();
      try {
        const copy = vi.spyOn(workbench.fileSystem.systemFt, 'copyPaths').mockResolvedValue('/root/docs/prd');
        workbench.select('docs/prd/001.md');
        http.expectOne(detailsUrl('docs/prd/001.md')).flush(fsEnvelope(fsDetails('docs/prd/001.md')));
        await vi.advanceTimersByTimeAsync(0);

        workbench.detailsFt.runProperty({ id: 'copy-location', shift: false });
        await vi.advanceTimersByTimeAsync(0);
        expect(copy).toHaveBeenLastCalledWith(['docs/prd'], 'native');
        expect(property('Location')?.badge).toBe('Copied');

        workbench.detailsFt.runProperty({ id: 'copy-location', shift: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(copy).toHaveBeenLastCalledWith(['docs/prd'], 'unix');

        await vi.advanceTimersByTimeAsync(1500);
        expect(property('Location')?.badge).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('copies a link’s target as it is, or the UNIX way', async () => {
      const copy = vi.spyOn(workbench.fileSystem.systemFt, 'copyText').mockResolvedValue('');
      await selectAndFlush('link', fsDetails('link', { type: 'symlink', symlinkTarget: 'C:\\Users\\me' }));

      workbench.detailsFt.runProperty({ id: 'copy-link-target', shift: true });
      await settled();
      expect(copy).toHaveBeenCalledWith('C:\\Users\\me', 'unix');
    });

    it('says why a path could not be copied', async () => {
      vi.spyOn(workbench.fileSystem.systemFt, 'copyPaths').mockRejectedValue(new Error('no clipboard'));
      const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
      await selectAndFlush('docs/a.md', fsDetails('docs/a.md'));

      workbench.detailsFt.runProperty({ id: 'copy-location', shift: false });
      await settled();
      expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not copy the path.' }));
      expect(property('Location')?.badge).toBeUndefined();
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
    it('offers a download, opening it elsewhere and renaming for a file', async () => {
      await selectAndFlush('README.md');

      // No Reveal in a browser: there is no file manager to show it in (PRD 003, §5).
      expect(workbench.detailsFt.actions().map((action) => action.id)).toEqual([
        'download',
        'open-external',
        'rename',
        'copy-path',
        'refresh',
      ]);
      expect(workbench.detailsFt.actions()[1]?.label).toBe('Open in New Browser Tab');
    });

    it('offers opening, uploading and renaming for a directory', async () => {
      await selectAndFlush('docs', fsDirectoryDetails('docs'));

      expect(workbench.detailsFt.actions().map((action) => action.id)).toEqual([
        'open',
        'upload',
        'rename',
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

      // Only the first byte is asked for, so a refusal shows up as a failed
      // row instead of disappearing into the browser (PRD 003, §1)...
      const check = http.expectOne(downloadUrl('docs/notes.md'));
      expect(check.request.headers.get('Range')).toBe('bytes=0-0');
      expect(hrefs).toEqual([]);
      check.flush(new Blob(['#']));
      await settled();

      // ...and the file itself is a browser transfer, not an `HttpClient` request.
      expect(hrefs).toEqual([downloadUrl('docs/notes.md')]);
      expect(names).toEqual(['notes.md']);
      http.expectNone(() => true);
      expect(workbench.transfersFt.rows()[0]).toMatchObject({ name: 'notes.md ← docs/notes.md', statusLabel: 'sent to browser' });
    });

    it('shows a download the server refuses as a failed transfer', async () => {
      await selectAndFlush('docs/notes.md');

      workbench.detailsFt.runAction('download');
      http
        .expectOne(downloadUrl('docs/notes.md'))
        .flush(new Blob([JSON.stringify(fsErrorBody('NOT_FOUND', 'Path not found: docs/notes.md'))]), {
          status: 404,
          statusText: 'Not Found',
        });
      await settled();

      expect(workbench.transfersFt.rows()[0]).toMatchObject({ icon: 'alert-triangle', statusLabel: 'failed · not found' });
    });

    it('copies the entry path to the clipboard', async () => {
      await selectAndFlush('docs/prd/001.md');
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      workbench.detailsFt.runAction('copy-path');
      await Promise.resolve();
      // The full path, which only the server knows (PRD 004, §1.3.2).
      http.expectOne((request) => request.url.startsWith('/api/fs/host-paths')).flush({ data: { paths: ['/srv/files/docs/prd/001.md'] } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(writeText).toHaveBeenCalledWith('/srv/files/docs/prd/001.md');
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
