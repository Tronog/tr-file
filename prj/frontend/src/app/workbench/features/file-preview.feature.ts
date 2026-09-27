import { signal, type WritableSignal } from '@angular/core';
import { Marked } from 'marked';
import type { UiDocumentModel, UiEmptyStateModel } from '@tr-file/ui';
import { MAX_IMAGE_BYTES } from '../../file-system/image-source.service';
import { FsError } from '../../file-system/fs-error';
import { sniffText, type SniffResult, type TextEncoding } from '../../file-system/text-sniff';
import type { WorkbenchService } from '../workbench.service';
import { isFile } from '../../file-system/fs-entry-kind';

/** Files past this size are not previewed; the user downloads them instead. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

/** Extensions rendered as markdown rather than as plain text. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);

/**
 * Extensions that are certainly not text, refused without reading a byte.
 * Only a shortcut: everything else is read and *looked at* (`sniffText`), so
 * an unlisted binary format is recognised by its content rather than shown as
 * garbage (PRD 003, §1).
 */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'jar',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'mkv', 'flac',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'so', 'dll', 'dylib', 'exe', 'bin', 'wasm', 'class', 'o', 'a',
]);

type PreviewStatus = 'loading' | 'ready' | 'refused' | 'error';

interface PreviewState {
  readonly status: PreviewStatus;
  readonly document?: UiDocumentModel;
  /** Why the file is not shown: too large, binary, or the request failed. */
  readonly notice?: UiEmptyStateModel;
}

/**
 * Read-only previews of files opened in a panel tab.
 *
 * Owns one cache of rendered documents, keyed by path, so a file open in two
 * groups is fetched and rendered once. Markdown becomes HTML here rather than
 * in the library: turning bytes into a document is a transformation, and the
 * viewer stays a component that renders what it is handed. The HTML still goes
 * through Angular's sanitizer at the binding, so a file that contains a script
 * tag is inert.
 *
 * An image is the one kind whose bytes are not transformed: `ImageSourceService`
 * turns them into a URL an `<img>` can load and owns its lifetime, because the
 * details sidebar draws the same picture from the same cache (§7.3.1, §9).
 * This feature only asks for it and reports what came back.
 *
 * Nothing about a preview is editable — the PRD asks for read-only, and there
 * is no write endpoint to be tempted by.
 */
export class FilePreviewFeature {
  private readonly previews: WritableSignal<ReadonlyMap<string, PreviewState>>;
  private readonly pending = new Set<string>();

  /** Configured once: GitHub-flavoured line breaks, no deprecated options. */
  private readonly markdown = new Marked({ gfm: true, breaks: false });

  constructor(private readonly parent: WorkbenchService) {
    this.previews = signal<ReadonlyMap<string, PreviewState>>(new Map());
  }

  /**
   * The document for a path, or `undefined` when it is not previewable.
   *
   * An image's `src` is read from the shared cache as the document is asked
   * for, never stored: the cache revokes URLs nobody is showing, and a stored
   * one would outlive its blob. Evicted means not shown until `load` reads it
   * again.
   */
  documentFor(path: string): UiDocumentModel | undefined {
    const document = this.previews().get(path)?.document;
    if (document?.kind !== 'image') {
      return document;
    }
    const src = this.parent.images.urlFor(path);
    return src === undefined ? undefined : { ...document, src };
  }

  /**
   * Forgets every preview no tab is showing (PRD 003, §1). A text preview is
   * up to `MAX_PREVIEW_BYTES` of string, and nothing else ever let one go.
   */
  retainOnly(paths: ReadonlySet<string>): void {
    const stale = [...this.previews().keys()].filter((path) => !paths.has(path) && !this.pending.has(path));
    if (stale.length === 0) {
      return;
    }
    this.previews.update((cache) => {
      const next = new Map(cache);
      for (const path of stale) {
        next.delete(path);
      }
      return next;
    });
  }

  /** The placeholder to show instead of a document: too large, binary, failed. */
  noticeFor(path: string): UiEmptyStateModel | undefined {
    return this.previews().get(path)?.notice;
  }

  isLoading(path: string): boolean {
    return this.previews().get(path)?.status === 'loading';
  }

  /**
   * Opens a file in the active group as a new tab, and reads it.
   *
   * A file already open there is simply activated, which is what makes
   * double-clicking the same file twice harmless.
   */
  open(path: string): void {
    const groupId = this.parent.activeGroupId();
    this.parent.select(path);
    this.parent.fileBrowserFt.openFile(groupId, path, this.nameOf(path));
    this.load(path);
  }

  /**
   * A double-click in the explorer. Only files open a preview — links to files
   * included: a directory, or a link to one, was already opened by the single
   * click that preceded it, and opening it twice would be noise.
   */
  openFromExplorer(path: string): void {
    const entry = this.parent.fsDataFt.entryAt(path);
    if (entry !== undefined && isFile(entry)) {
      this.open(path);
    }
  }

  /**
   * Reads and renders a file unless it is cached or already in flight — or,
   * for an image, unless the picture itself is still in the shared cache,
   * which lets go of pictures nobody was showing.
   */
  load(path: string): void {
    if (this.pending.has(path)) {
      return;
    }
    const cached = this.previews().get(path);
    const evicted = cached?.document?.kind === 'image' && this.parent.images.urlFor(path) === undefined;
    if (cached !== undefined && !evicted) {
      return;
    }
    void this.fetch(path, false);
  }

  /** Re-reads a file that is already open (the group's Refresh action). */
  reload(path: string): void {
    if (!this.pending.has(path)) {
      void this.fetch(path, true);
    }
  }

  private async fetch(path: string, force: boolean): Promise<void> {
    this.pending.add(path);
    // A reload keeps the document up until the new one replaces it.
    const previous = this.previews().get(path)?.document;
    this.patch(path, { status: 'loading', ...(previous ? { document: previous } : {}) });

    const refusal = this.refuse(path);
    if (refusal) {
      this.patch(path, { status: 'refused', notice: refusal });
      this.pending.delete(path);
      return;
    }

    try {
      if (this.parent.images.isImage(path)) {
        this.patch(path, await this.renderImage(path, force));
      } else {
        const blob = await this.parent.fileSystem.transferFt.download(path, MAX_PREVIEW_BYTES);
        if (blob.size > MAX_PREVIEW_BYTES) {
          throw new FsError(`File is larger than the ${MAX_PREVIEW_BYTES} byte preview limit`, 413, 'PAYLOAD_TOO_LARGE');
        }
        this.patch(path, this.render(path, sniffText(new Uint8Array(await blob.arrayBuffer()))));
      }
    } catch (error) {
      const failure = FsError.from(error);
      this.patch(path, {
        status: 'error',
        notice: {
          icon: 'alert-triangle',
          title: 'Could not open this file',
          hint: failure.message,
        },
      });
    } finally {
      this.pending.delete(path);
    }
  }

  /** Turns file bytes into a document, or into a notice if they are not text. */
  private render(path: string, sniffed: SniffResult): PreviewState {
    if (sniffed.kind === 'binary') {
      return {
        status: 'refused',
        notice: {
          icon: 'file',
          title: 'Binary file not shown',
          hint: 'Download it to open it in another application.',
        },
      };
    }

    const { text, encoding } = sniffed;
    const meta = this.metaFor(path, text, encoding);
    if (MARKDOWN_EXTENSIONS.has(this.extension(path))) {
      return {
        status: 'ready',
        document: {
          path,
          kind: 'markdown',
          html: this.markdown.parse(text, { async: false }),
          ...(meta ? { meta } : {}),
        },
      };
    }

    return {
      status: 'ready',
      document: { path, kind: 'text', text, ...(meta ? { meta } : {}) },
    };
  }

  /**
   * Asks the shared cache for the picture, and turns whatever came back into a
   * document or a notice.
   *
   * `load` takes whatever the cache already has — the details sidebar may well
   * have read this very file already (§9) — while a Refresh insists on going
   * back to disk.
   */
  private async renderImage(path: string, force: boolean): Promise<PreviewState> {
    const images = this.parent.images;
    await (force ? images.reload(path) : images.load(path));

    const url = images.urlFor(path);
    if (url === undefined) {
      const failure = images.errorFor(path);
      return {
        status: failure?.code === 'PAYLOAD_TOO_LARGE' ? 'refused' : 'error',
        notice: {
          icon: failure?.code === 'PAYLOAD_TOO_LARGE' ? 'file' : 'alert-triangle',
          title:
            failure?.code === 'PAYLOAD_TOO_LARGE'
              ? 'Image is too large to preview'
              : 'Could not open this file',
          hint: failure?.message ?? 'The image could not be read.',
        },
      };
    }

    // No `src` here: `documentFor` reads it from the cache, which owns it.
    const meta = this.imageMetaFor(path);
    return { status: 'ready', document: { path, kind: 'image', ...(meta ? { meta } : {}) } };
  }

  /** `'2.4 MB · PNG'`; the pixel size is only known once the viewer loads it. */
  private imageMetaFor(path: string): string {
    const entry = this.parent.fsDataFt.entryAt(path);
    const size = entry ? this.parent.fileViewModel.formatBytes(entry.size) : '';
    const extension = this.extension(path).toUpperCase();
    return [size, extension].filter(Boolean).join(' · ');
  }

  /** Reasons a file is refused before a single byte is fetched. */
  private refuse(path: string): UiEmptyStateModel | undefined {
    const entry = this.parent.fsDataFt.entryAt(path);

    // Images are previewable, and their own budget is far larger, so they are
    // answered before the binary deny-list gets a chance to refuse them.
    if (this.parent.images.isImage(path)) {
      return entry && entry.size > MAX_IMAGE_BYTES
        ? {
            icon: 'file',
            title: 'Image is too large to preview',
            hint: `${this.parent.fileViewModel.formatBytes(entry.size)} — download it instead.`,
          }
        : undefined;
    }

    if (BINARY_EXTENSIONS.has(this.extension(path))) {
      return {
        icon: 'file',
        title: 'Binary file not shown',
        hint: 'Download it to open it in another application.',
      };
    }

    if (entry && entry.size > MAX_PREVIEW_BYTES) {
      return {
        icon: 'file',
        title: 'File is too large to preview',
        hint: `${this.parent.fileViewModel.formatBytes(entry.size)} — download it instead.`,
      };
    }

    return undefined;
  }

  /**
   * `'2.4 KB · 91 lines'`, from what is actually known about the file — and
   * its encoding when that is not UTF-8, since that is worth knowing.
   */
  private metaFor(path: string, text: string, encoding: TextEncoding): string | undefined {
    const entry = this.parent.fsDataFt.entryAt(path);
    const lines = text === '' ? 0 : text.split('\n').length;
    const size = entry ? this.parent.fileViewModel.formatBytes(entry.size) : undefined;
    const parts = [
      size,
      `${lines} ${lines === 1 ? 'line' : 'lines'}`,
      encoding === 'UTF-8' ? undefined : encoding,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }

  private patch(path: string, state: PreviewState): void {
    this.previews.update((cache) => new Map(cache).set(path, state));
  }

  private nameOf(path: string): string {
    return path.split('/').at(-1) ?? path;
  }

  private extension(path: string): string {
    const name = this.nameOf(path);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }
}
