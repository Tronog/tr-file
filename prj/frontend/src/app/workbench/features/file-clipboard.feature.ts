import { computed, signal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/** What is on the clipboard: entries to copy, or to move (cut). */
export interface FileClipboard {
  readonly mode: 'copy' | 'cut';
  readonly paths: readonly string[];
}

/**
 * Copy, cut and paste of files and folders (PRD 005, §2), the way any file
 * manager does it: `Ctrl`+`C` / `Ctrl`+`X` put the panel's selection on the
 * clipboard, `Ctrl`+`V` puts it into the folder a panel is showing — the same
 * panel or another. Cut entries are drawn faded until they are pasted.
 *
 * The clipboard is the workbench's own, not the system's: it holds paths on
 * the backend the window is using, which mean nothing to another program. A
 * paste is a copy or move job of `OperationsFeature`, so it asks about taken
 * names and shows its progress like any other; pasting a copy into the folder
 * it came from makes `name copy.ext`. A cut is used up by its paste; a copy
 * can be pasted again and again.
 *
 * On the desktop, for its own computer's files, it is the system's too
 * (PRD 003, §6): what is copied or cut here is put on the system clipboard
 * as files, for the system's file manager to paste, and a paste takes what
 * the system clipboard holds when that is something else — files copied in
 * another file manager since — rather than what was last copied here.
 */
export class FileClipboardFeature {
  private readonly content = signal<FileClipboard | null>(null);

  /** What this window last put on the system clipboard, to know it again when it is still there. */
  private written: string | null = null;

  constructor(private readonly parent: WorkbenchService) {}

  readonly clipboard = this.content.asReadonly();

  /**
   * Whether there may be anything to paste — for the Edit menu. Where the
   * system clipboard is shared, whether it holds files is only known by
   * asking, so a paste is always offered.
   */
  readonly canPaste = computed(() => this.content() !== null || this.sharesFiles());

  private readonly sharesFiles = computed(() => this.parent.fileSystem.systemFt.sharesFiles(this.parent.connection.connected()));

  private readonly cutPaths = computed(() => {
    const content = this.content();
    return new Set(content?.mode === 'cut' ? content.paths : []);
  });

  /** Whether `path` is waiting to be moved; its row is drawn faded. */
  isCut(path: string): boolean {
    return this.cutPaths().has(path);
  }

  /** `Ctrl`+`C`: the panel's selection — or the entry the key was pressed on. */
  copy(groupId = this.parent.activeGroupId(), entryId: string | null = null): void {
    this.put('copy', groupId, entryId);
  }

  /** `Ctrl`+`X`. */
  cut(groupId = this.parent.activeGroupId(), entryId: string | null = null): void {
    this.put('cut', groupId, entryId);
  }

  /** `Ctrl`+`V`: into the folder the panel is showing. A file tab has none, and takes nothing. */
  async paste(groupId = this.parent.activeGroupId()): Promise<void> {
    const destination = this.folderOf(groupId);
    if (destination === null) {
      return;
    }
    await this.pasteInto(destination);
  }

  /** Entries that no longer exist where they were — moved, trashed — leave the clipboard. */
  forget(gone: (path: string) => boolean): void {
    const content = this.content();
    if (content === null) {
      return;
    }
    const paths = content.paths.filter((path) => !gone(path));
    if (paths.length !== content.paths.length) {
      this.content.set(paths.length === 0 ? null : { ...content, paths });
    }
  }

  /** Entries renamed or moved back by Undo keep their place on the clipboard, under their new paths. */
  relocate(move: (path: string) => string): void {
    const content = this.content();
    if (content !== null && content.paths.some((path) => move(path) !== path)) {
      this.content.set({ ...content, paths: content.paths.map(move) });
    }
  }

  /** Puts `paths` on the clipboard as they are — a context menu's entries rather than a panel's selection. */
  putPaths(mode: FileClipboard['mode'], paths: readonly string[]): void {
    if (paths.length > 0) {
      this.set({ mode, paths: [...paths] });
    }
  }

  /** Pastes into `folder` — a context menu's folder, which need not be the one a panel lists. */
  async pasteInto(folder: string): Promise<void> {
    const system = await this.fromSystem();
    const content = system ?? this.content();
    if (content === null) {
      return;
    }
    const started = await this.parent.operationsFt.transfer(content.mode === 'cut' ? 'move' : 'copy', content.paths, folder);
    if (started && content.mode === 'cut' && system === null && this.content() === content) {
      this.content.set(null);
    }
  }

  /**
   * Files the system clipboard holds that this window did not put there —
   * copied in the system's file manager — or `null` to paste this window's
   * own. Files this window cannot reach are said so, when there is nothing
   * of its own to paste instead.
   */
  private async fromSystem(): Promise<FileClipboard | null> {
    if (!this.sharesFiles()) {
      return null;
    }
    let files;
    try {
      files = await this.parent.fileSystem.systemFt.readClipboard();
    } catch {
      return null;
    }
    if (files.paths.length > 0 && FileClipboardFeature.keyOf(files.paths) !== this.written) {
      return { mode: files.cut ? 'cut' : 'copy', paths: files.paths };
    }
    if (files.paths.length === 0 && files.outside > 0 && this.content() === null) {
      await this.parent.modal.message({
        message: files.outside === 1 ? 'The file on the clipboard cannot be pasted here.' : 'The files on the clipboard cannot be pasted here.',
        detail: 'They are outside the folders this window can reach.',
      });
    }
    return null;
  }

  /** Keeps what was copied or cut, and hands it to the system clipboard too, where it is shared. */
  private set(content: FileClipboard): void {
    this.content.set(content);
    if (this.sharesFiles()) {
      this.written = FileClipboardFeature.keyOf(content.paths);
      void this.parent.fileSystem.systemFt.writeClipboard(content.paths, content.mode === 'cut').catch(() => undefined);
    }
  }

  private static keyOf(paths: readonly string[]): string {
    return [...paths].sort().join('\n');
  }

  clear(): void {
    this.content.set(null);
  }

  private put(mode: FileClipboard['mode'], groupId: string, entryId: string | null): void {
    const paths = this.parent.operationsFt.selectionIn(groupId, entryId);
    if (paths.length > 0) {
      this.set({ mode, paths: [...paths] });
    }
  }

  /** The folder a panel lists, or `null` when it shows a file. */
  private folderOf(groupId: string): string | null {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    return group !== undefined && groups.activeTabOf(group)?.kind === 'folder' ? group.path : null;
  }
}
