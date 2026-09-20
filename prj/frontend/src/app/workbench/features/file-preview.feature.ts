import { signal, type WritableSignal } from '@angular/core';
import { Marked } from 'marked';
import type { UiDocumentModel, UiEmptyStateModel } from '@tr-file/ui';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

/** Files past this size are not previewed; the user downloads them instead. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

/** Extensions rendered as markdown rather than as plain text. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd']);

/**
 * Extensions that are certainly not text. Anything else is attempted and
 * rejected on sight of a NUL byte — a deny-list of the common binaries beats
 * an allow-list that would refuse every unfamiliar source file.
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

  /** The document for a path, or `undefined` when it is not previewable. */
  documentFor(path: string): UiDocumentModel | undefined {
    return this.previews().get(path)?.document;
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
    this.parent.editorGroupsFt.openFile(groupId, path, this.nameOf(path));
    this.load(path);
  }

  /**
   * A double-click in the explorer. Only files open a preview: a directory was
   * already opened by the single click that preceded it, and opening it twice
   * would be noise.
   */
  openFromExplorer(path: string): void {
    const type = this.parent.fsDataFt.entryAt(path)?.type;
    if (type === 'file' || type === 'symlink') {
      this.open(path);
    }
  }

  /** Reads and renders a file unless it is cached or already in flight. */
  load(path: string): void {
    if (this.pending.has(path) || this.previews().has(path)) {
      return;
    }
    void this.fetch(path);
  }

  /** Re-reads a file that is already open (the group's Refresh action). */
  reload(path: string): void {
    if (!this.pending.has(path)) {
      void this.fetch(path);
    }
  }

  private async fetch(path: string): Promise<void> {
    this.pending.add(path);
    this.patch(path, { status: 'loading' });

    const refusal = this.refuse(path);
    if (refusal) {
      this.patch(path, { status: 'refused', notice: refusal });
      this.pending.delete(path);
      return;
    }

    try {
      const text = await this.parent.fileSystem.transferFt.readText(path, MAX_PREVIEW_BYTES);
      this.patch(path, this.render(path, text));
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

  /** Turns file text into a document, or into a notice if it is not text. */
  private render(path: string, text: string): PreviewState {
    // A NUL byte in the first few KB is the classic "this is not text" tell.
    if (text.slice(0, 8192).includes('\0')) {
      return {
        status: 'refused',
        notice: {
          icon: 'file',
          title: 'Binary file not shown',
          hint: 'Download it to open it in another application.',
        },
      };
    }

    const meta = this.metaFor(path, text);
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

  /** Reasons a file is refused before a single byte is fetched. */
  private refuse(path: string): UiEmptyStateModel | undefined {
    const entry = this.parent.fsDataFt.entryAt(path);

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

  /** `'2.4 KB · 91 lines'`, from what is actually known about the file. */
  private metaFor(path: string, text: string): string | undefined {
    const entry = this.parent.fsDataFt.entryAt(path);
    const lines = text === '' ? 0 : text.split('\n').length;
    const size = entry ? this.parent.fileViewModel.formatBytes(entry.size) : undefined;
    const parts = [size, `${lines} ${lines === 1 ? 'line' : 'lines'}`].filter(Boolean);
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
