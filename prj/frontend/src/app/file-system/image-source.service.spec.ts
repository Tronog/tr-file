import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { downloadUrl, settled } from '../workbench/testing/fs-fixtures';
import { ImageSourceService } from './image-source.service';

/**
 * PRD 003, §1 — the image cache frees what nothing shows. Before this, every
 * image ever previewed kept its blob, up to 32 MiB apiece, for the session.
 */
describe('ImageSourceService', () => {
  let images: ImageSourceService;
  let http: HttpTestingController;
  let revoked: string[];

  beforeEach(() => {
    revoked = [];
    let made = 0;
    URL.createObjectURL = () => `blob:image/${(made += 1)}`;
    URL.revokeObjectURL = (url: string) => void revoked.push(url);

    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    images = TestBed.inject(ImageSourceService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Reads one picture and answers its request. */
  const load = async (path: string): Promise<void> => {
    const loading = images.load(path);
    http.expectOne(downloadUrl(path)).flush(new Blob(['PNG'], { type: 'image/png' }));
    await loading;
  };

  it('keeps everything until it has been told what is on screen', async () => {
    for (let index = 0; index < 12; index += 1) {
      await load(`photo-${index}.png`);
    }

    expect(images.size).toBe(12);
    expect(revoked).toEqual([]);
  });

  it('never frees a picture that is on screen', async () => {
    await load('shown.png');

    images.retainOnly(new Set(['shown.png']));

    expect(images.urlFor('shown.png')).toBeDefined();
    expect(revoked).toEqual([]);
  });

  it('keeps a few recent pictures nobody shows, and frees the oldest past that', async () => {
    for (let index = 0; index < 10; index += 1) {
      await load(`photo-${index}.png`);
    }

    images.retainOnly(new Set());

    expect(images.size).toBe(8);
    expect(images.urlFor('photo-0.png')).toBeUndefined();
    expect(images.urlFor('photo-9.png')).toBeDefined();
    expect(revoked).toHaveLength(2);
  });

  /** A quick run down a photo folder: each thumbnail is let go as the next arrives. */
  it('lets go of a picture that arrives after it stopped being wanted', async () => {
    images.retainOnly(new Set());
    for (let index = 0; index < 10; index += 1) {
      await load(`photo-${index}.png`);
    }

    expect(images.size).toBe(8);
  });

  it('forgets a failure nobody is looking at, so asking again retries', async () => {
    const loading = images.load('broken.png');
    http.expectOne(downloadUrl('broken.png')).flush(new Blob(['nope']), { status: 500, statusText: 'Server Error' });
    await loading;
    expect(images.errorFor('broken.png')).toBeDefined();

    images.retainOnly(new Set());

    expect(images.errorFor('broken.png')).toBeUndefined();
    void images.load('broken.png');
    http.expectOne(downloadUrl('broken.png')).flush(new Blob(['PNG']));
    await settled();
  });

  it('takes back a picture that is wanted again before it is evicted', async () => {
    await load('photo.png');
    images.retainOnly(new Set());

    images.retainOnly(new Set(['photo.png']));
    await images.load('photo.png');

    // Still cached: no second request, and nothing revoked.
    http.expectNone(downloadUrl('photo.png'));
    expect(revoked).toEqual([]);
  });
});
