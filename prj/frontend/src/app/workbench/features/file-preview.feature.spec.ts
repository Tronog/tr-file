import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  detailsUrl,
  downloadUrl,
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

const ROOT_ENTRIES = [
  fsDirectory('docs'),
  fsEntry('README.md', { size: 512 }),
  fsEntry('main.ts', { size: 240 }),
  fsEntry('logo.png', { size: 4096 }),
  fsEntry('huge.txt', { size: 5 * 1024 * 1024 }),
  fsEntry('archive.zip', { size: 4096 }),
  fsEntry('poster.jpg', { size: 64 * 1024 * 1024 }),
];

describe('FilePreviewFeature', () => {
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

  /** Brings the workbench up so the root listing (and its sizes) are known. */
  const start = async (): Promise<void> => {
    workbench.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', ROOT_ENTRIES)));
    http.expectOne(detailsUrl('')).flush(fsEnvelope(fsDetails('', { type: 'directory' })));
    await settled();
  };

  /** Opens a file and answers the two requests that follow. */
  const open = async (path: string, body: string, type = 'text/plain'): Promise<void> => {
    workbench.filePreviewFt.open(path);
    http.expectOne(detailsUrl(path)).flush(fsEnvelope(fsDetails(path)));
    http.expectOne(downloadUrl(path)).flush(new Blob([body], { type }));
    await settled();
  };

  describe('markdown', () => {
    it('renders it to HTML', async () => {
      await start();
      await open('README.md', '# Title\n\nSome **bold** text.\n', 'text/markdown');

      const document = workbench.filePreviewFt.documentFor('README.md');
      expect(document?.kind).toBe('markdown');
      expect(document?.html).toContain('<h1>Title</h1>');
      expect(document?.html).toContain('<strong>bold</strong>');
      expect(document?.text).toBeUndefined();
    });

    it('reports the size and line count in the status meta', async () => {
      await start();
      await open('README.md', 'one\ntwo\nthree\n', 'text/markdown');

      expect(workbench.filePreviewFt.documentFor('README.md')?.meta).toBe('512 B · 4 lines');
    });
  });

  describe('other text', () => {
    it('is kept verbatim rather than rendered', async () => {
      await start();
      await open('main.ts', 'const x = 1; // **not bold**\n');

      const document = workbench.filePreviewFt.documentFor('main.ts');
      expect(document?.kind).toBe('text');
      expect(document?.text).toBe('const x = 1; // **not bold**\n');
      expect(document?.html).toBeUndefined();
    });
  });

  /** PRD 001, §7.3.1 — images are previewed rather than refused. */
  describe('images', () => {
    /** URL.createObjectURL does not exist in jsdom; record what it is given. */
    let made: string[];
    let revoked: string[];

    beforeEach(() => {
      made = [];
      revoked = [];
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = `blob:image/${made.length}/${(blob as Blob).size}`;
        made.push(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => void revoked.push(url);
    });

    /** Fetches an image and answers both requests it makes. */
    const openImage = async (path: string, bytes = 'PNGDATA'): Promise<void> => {
      workbench.filePreviewFt.open(path);
      http.expectOne(detailsUrl(path)).flush(fsEnvelope(fsDetails(path)));
      http.expectOne(downloadUrl(path)).flush(new Blob([bytes], { type: 'image/png' }));
      await settled();
    };

    it('hands the bytes to the viewer as an object URL', async () => {
      await start();
      await openImage('logo.png');

      expect(workbench.filePreviewFt.noticeFor('logo.png')).toBeUndefined();
      expect(workbench.filePreviewFt.documentFor('logo.png')).toMatchObject({
        path: 'logo.png',
        kind: 'image',
        src: made[0],
      });
    });

    it('names the size and the format on the status line', async () => {
      await start();
      await openImage('logo.png');

      // The listing's size, not the blob's: the same source the text preview's
      // status line uses, so the two never disagree about one file.
      expect(workbench.filePreviewFt.documentFor('logo.png')?.meta).toBe('4.0 KB · PNG');
    });

    /** An `<img>` cannot run script, so an SVG is as inert here as a PNG. */
    it('previews an SVG too', async () => {
      await start();
      workbench.filePreviewFt.open('docs/diagram.svg');
      http.expectOne(detailsUrl('docs/diagram.svg')).flush(fsEnvelope(fsDetails('docs/diagram.svg')));
      http
        .expectOne(downloadUrl('docs/diagram.svg'))
        .flush(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
      await settled();

      expect(workbench.filePreviewFt.documentFor('docs/diagram.svg')).toMatchObject({
        kind: 'image',
      });
    });

    /** Images get their own, far larger budget than text does. */
    it('refuses one past the image limit without fetching it', async () => {
      await start();

      workbench.filePreviewFt.open('poster.jpg');
      http.expectOne(detailsUrl('poster.jpg')).flush(fsEnvelope(fsDetails('poster.jpg')));
      await settled();

      http.expectNone(downloadUrl('poster.jpg'));
      expect(workbench.filePreviewFt.noticeFor('poster.jpg')).toMatchObject({
        title: 'Image is too large to preview',
      });
    });

    /** The feature made the URL, so the feature is the only one who can free it. */
    it('revokes the previous URL when the image is reloaded', async () => {
      await start();
      await openImage('logo.png');
      expect(revoked).toEqual([]);

      workbench.filePreviewFt.reload('logo.png');
      http.expectOne(downloadUrl('logo.png')).flush(new Blob(['PNGDATA2'], { type: 'image/png' }));
      await settled();

      expect(revoked).toEqual([made[0]]);
      expect(workbench.filePreviewFt.documentFor('logo.png')?.src).toBe(made[1]);
    });
  });

  describe('files that are not shown', () => {
    it('refuses a known binary extension without fetching it', async () => {
      await start();

      workbench.filePreviewFt.open('archive.zip');
      http.expectOne(detailsUrl('archive.zip')).flush(fsEnvelope(fsDetails('archive.zip')));
      await settled();

      // No download was requested at all.
      http.expectNone(downloadUrl('archive.zip'));
      expect(workbench.filePreviewFt.documentFor('archive.zip')).toBeUndefined();
      expect(workbench.filePreviewFt.noticeFor('archive.zip')).toMatchObject({
        title: 'Binary file not shown',
      });
    });

    it('refuses a file larger than the preview limit, naming its size', async () => {
      await start();

      workbench.filePreviewFt.open('huge.txt');
      http.expectOne(detailsUrl('huge.txt')).flush(fsEnvelope(fsDetails('huge.txt')));
      await settled();

      http.expectNone(downloadUrl('huge.txt'));
      expect(workbench.filePreviewFt.noticeFor('huge.txt')).toMatchObject({
        title: 'File is too large to preview',
        hint: '5.0 MB — download it instead.',
      });
    });

    it('refuses text that turns out to contain NUL bytes', async () => {
      await start();
      await open('main.ts', 'MZ\u0000\u0000binary payload');

      expect(workbench.filePreviewFt.documentFor('main.ts')).toBeUndefined();
      expect(workbench.filePreviewFt.noticeFor('main.ts')).toMatchObject({
        title: 'Binary file not shown',
      });
    });

    it('reports a failed read with the server message', async () => {
      await start();

      workbench.filePreviewFt.open('README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      http
        .expectOne(downloadUrl('README.md'))
        .flush(new Blob([JSON.stringify(fsErrorBody('FORBIDDEN', 'Permission denied: README.md'))], {
          type: 'application/json',
        }), { status: 403, statusText: 'Forbidden' });
      await settled();

      expect(workbench.filePreviewFt.noticeFor('README.md')).toMatchObject({
        title: 'Could not open this file',
        hint: 'Permission denied: README.md',
      });
    });
  });

  describe('caching', () => {
    it('reads a file once, however often it is opened', async () => {
      await start();
      await open('main.ts', 'const x = 1;\n');

      workbench.filePreviewFt.open('main.ts');
      await settled();

      http.expectNone(downloadUrl('main.ts'));
      expect(workbench.filePreviewFt.documentFor('main.ts')?.text).toBe('const x = 1;\n');
    });

    it('reload re-reads a file that is already open', async () => {
      await start();
      await open('main.ts', 'const x = 1;\n');

      workbench.filePreviewFt.reload('main.ts');
      http.expectOne(downloadUrl('main.ts')).flush(new Blob(['const x = 2;\n']));
      await settled();

      expect(workbench.filePreviewFt.documentFor('main.ts')?.text).toBe('const x = 2;\n');
    });

    it('is loading while the bytes are in flight', async () => {
      await start();

      workbench.filePreviewFt.open('main.ts');
      http.expectOne(detailsUrl('main.ts')).flush(fsEnvelope(fsDetails('main.ts')));
      const request = http.expectOne(downloadUrl('main.ts'));

      expect(workbench.filePreviewFt.isLoading('main.ts')).toBe(true);

      request.flush(new Blob(['ok']));
      await settled();

      expect(workbench.filePreviewFt.isLoading('main.ts')).toBe(false);
    });
  });

  describe('openFromExplorer()', () => {
    it('opens a file', async () => {
      await start();

      workbench.filePreviewFt.openFromExplorer('README.md');
      http.expectOne(detailsUrl('README.md')).flush(fsEnvelope(fsDetails('README.md')));
      http.expectOne(downloadUrl('README.md')).flush(new Blob(['# Title']));
      await settled();

      expect(workbench.filePreviewFt.documentFor('README.md')).toBeDefined();
    });

    it('ignores a directory, which the single click already opened', async () => {
      await start();

      workbench.filePreviewFt.openFromExplorer('docs');
      await settled();

      // No details, no download: a double-clicked folder is simply not a file.
      http.expectNone(detailsUrl('docs'));
      http.expectNone(downloadUrl('docs'));
      expect(workbench.editorGroupsFt.group(workbench.activeGroupId())?.tabs).toHaveLength(1);
    });

    it('ignores an entry the listing has never seen', async () => {
      await start();

      workbench.filePreviewFt.openFromExplorer('nowhere.txt');
      await settled();

      http.expectNone(downloadUrl('nowhere.txt'));
    });
  });

  describe('the tab it opens', () => {
    it('is added once and re-activated on a second open', async () => {
      await start();
      await open('README.md', '# Title', 'text/markdown');

      const groupId = workbench.activeGroupId();
      workbench.editorGroupsFt.selectTab(groupId, 'tab-root');
      expect(workbench.editorGroupsFt.group(groupId)?.tabs[0]).toMatchObject({ active: true });

      workbench.filePreviewFt.open('README.md');
      await settled();

      const tabs = workbench.editorGroupsFt.group(groupId)?.tabs ?? [];
      expect(tabs).toHaveLength(2);
      expect(tabs[1]).toMatchObject({ label: 'README.md', active: true });
    });

    it('survives opening a folder from the sidebar', async () => {
      await start();
      await open('README.md', '# Title', 'text/markdown');
      const groupId = workbench.activeGroupId();

      // Opening a folder must not rewrite the preview tab underneath it.
      workbench.editorGroupsFt.openFolder(groupId, 'docs', 'docs');
      http.expectOne(listUrl('docs')).flush(fsEnvelope(fsListing('docs', [])));
      await settled();

      const tabs = workbench.editorGroupsFt.group(groupId)?.tabs ?? [];
      expect(tabs.map((tab) => tab.label)).toEqual(['tr-file', 'README.md', 'docs']);
      expect(tabs[2]).toMatchObject({ active: true });
      expect(workbench.filePreviewFt.documentFor('README.md')).toBeDefined();
    });
  });
});
