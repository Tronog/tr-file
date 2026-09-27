import { signal } from '@angular/core';
import type { FsEntry } from '../../file-system/file-system.model';
import { isFile } from '../../file-system/fs-entry-kind';
import type { WorkbenchService } from '../workbench.service';

/** The longest side of a thumbnail, in CSS pixels, doubled for sharp screens. */
const THUMBNAIL_SIZE = 128;

/** Images past this are not read for a thumbnail: a picture of a 60 MB photo is not worth 60 MB. */
export const THUMBNAIL_MAX_BYTES = 16 * 1024 * 1024;

/** Pictures read at once; the rest wait, so a folder of photos is not a flood. */
const CONCURRENCY = 3;

/** Thumbnails kept; the least recently shown is freed first. */
const KEEP = 400;

/** A thumbnail, and what it is a picture of — a file that changes gets a new one. */
interface Thumbnail {
  readonly url: string;
  readonly version: string;
}

/**
 * Pictures of images for the icon view (PRD 003, §6).
 *
 * Made here, in the page, from the image itself: read — through whichever
 * transport the window has, so a remote server's photos work the same — then
 * scaled down to `THUMBNAIL_SIZE` and kept as a small object URL, the
 * original dropped. Only what the grid has on screen is asked for
 * (`UiIconView.shown`), `CONCURRENCY` at a time, newest request first; images
 * past `THUMBNAIL_MAX_BYTES`, and any the browser cannot decode, keep their
 * icon. At most `KEEP` are held, the oldest freed as new ones come.
 *
 * A thumbnail belongs to a version of a file — its size and time — so a file
 * that changed on disk is drawn again rather than shown as it was.
 */
export class ThumbnailsFeature {
  private readonly thumbnails = signal<ReadonlyMap<string, Thumbnail>>(new Map());
  /** Paths waiting to be read, most recently asked for last. */
  private queue: string[] = [];
  private readonly working = new Set<string>();
  /** Versions that could not be made, so they are not tried again. */
  private readonly failed = new Map<string, string>();

  constructor(private readonly parent: WorkbenchService) {}

  /** The thumbnail of an entry, if there is one of this version of it. */
  urlFor(entry: FsEntry): string | undefined {
    // Off in the settings (PRD 010, §1): the icon view draws file icons.
    if (!this.parent.preferencesFt.value('files.thumbnails')) {
      return undefined;
    }
    const thumbnail = this.thumbnails().get(entry.path);
    return thumbnail !== undefined && thumbnail.version === ThumbnailsFeature.versionOf(entry) ? thumbnail.url : undefined;
  }

  /** Whether a thumbnail can be made of an entry at all. */
  canMake(entry: FsEntry): boolean {
    return (
      isFile(entry) &&
      entry.size > 0 &&
      entry.size <= THUMBNAIL_MAX_BYTES &&
      this.parent.images.isImage(entry.path) &&
      typeof globalThis.createImageBitmap === 'function' &&
      typeof globalThis.OffscreenCanvas === 'function'
    );
  }

  /** The grid shows these entries now: make the thumbnails they lack. */
  request(paths: readonly string[]): void {
    if (!this.parent.preferencesFt.value('files.thumbnails')) {
      return;
    }
    const wanted = paths
      .map((path) => this.parent.fsDataFt.entryAt(path))
      .filter((entry): entry is FsEntry => entry !== undefined && this.canMake(entry))
      .filter((entry) => this.urlFor(entry) === undefined && this.failed.get(entry.path) !== ThumbnailsFeature.versionOf(entry))
      .map((entry) => entry.path);
    if (wanted.length === 0) {
      return;
    }
    // What is on screen now goes before what was on screen a moment ago.
    const fresh = new Set(wanted);
    this.queue = [...this.queue.filter((path) => !fresh.has(path)), ...wanted];
    this.pump();
  }

  /** Frees every thumbnail; the panels will ask again for what they show. */
  clear(): void {
    for (const thumbnail of this.thumbnails().values()) {
      URL.revokeObjectURL(thumbnail.url);
    }
    this.thumbnails.set(new Map());
    this.queue = [];
    this.failed.clear();
  }

  private pump(): void {
    while (this.working.size < CONCURRENCY && this.queue.length > 0) {
      const path = this.queue.pop() as string;
      if (this.working.has(path)) {
        continue;
      }
      this.working.add(path);
      void this.make(path).finally(() => {
        this.working.delete(path);
        this.pump();
      });
    }
  }

  private async make(path: string): Promise<void> {
    const entry = this.parent.fsDataFt.entryAt(path);
    if (entry === undefined || !this.canMake(entry) || this.urlFor(entry) !== undefined) {
      return;
    }
    const version = ThumbnailsFeature.versionOf(entry);
    try {
      const blob = await this.parent.fileSystem.transferFt.download(path, THUMBNAIL_MAX_BYTES);
      const small = await ThumbnailsFeature.scale(blob);
      this.keep(path, { url: URL.createObjectURL(small), version });
    } catch {
      this.failed.set(path, version);
    }
  }

  private keep(path: string, thumbnail: Thumbnail): void {
    const next = new Map(this.thumbnails());
    const previous = next.get(path);
    if (previous !== undefined) {
      URL.revokeObjectURL(previous.url);
      next.delete(path);
    }
    next.set(path, thumbnail);
    // A `Map` keeps insertion order: the first ones are the oldest.
    for (const [oldPath, old] of next) {
      if (next.size <= KEEP) {
        break;
      }
      URL.revokeObjectURL(old.url);
      next.delete(oldPath);
    }
    this.thumbnails.set(next);
  }

  /** The image, decoded and drawn at most `THUMBNAIL_SIZE` on its longer side. */
  private static async scale(blob: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    try {
      const ratio = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * ratio));
      const height = Math.max(1, Math.round(bitmap.height * ratio));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('No 2D canvas');
      }
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    } finally {
      bitmap.close();
    }
  }

  private static versionOf(entry: FsEntry): string {
    return `${entry.size}:${entry.modifiedAt}`;
  }
}
