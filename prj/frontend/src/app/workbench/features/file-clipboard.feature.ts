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
 */
export class FileClipboardFeature {
  private readonly content = signal<FileClipboard | null>(null);

  constructor(private readonly parent: WorkbenchService) {}

  readonly clipboard = this.content.asReadonly();

  /** Whether there is anything to paste — for the Edit menu. */
  readonly canPaste = computed(() => this.content() !== null);

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
    const content = this.content();
    const destination = this.folderOf(groupId);
    if (content === null || destination === null) {
      return;
    }
    const started = await this.parent.operationsFt.transfer(
      content.mode === 'cut' ? 'move' : 'copy',
      content.paths,
      destination,
    );
    if (started && content.mode === 'cut' && this.content() === content) {
      this.content.set(null);
    }
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

  clear(): void {
    this.content.set(null);
  }

  private put(mode: FileClipboard['mode'], groupId: string, entryId: string | null): void {
    const paths = this.parent.operationsFt.selectionIn(groupId, entryId);
    if (paths.length > 0) {
      this.content.set({ mode, paths: [...paths] });
    }
  }

  /** The folder a panel lists, or `null` when it shows a file. */
  private folderOf(groupId: string): string | null {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    return group !== undefined && groups.activeTabOf(group)?.kind === 'folder' ? group.path : null;
  }
}
