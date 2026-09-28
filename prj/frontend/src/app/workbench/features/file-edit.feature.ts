import type { FsDetails } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';
import { shownPath } from '../../file-system/fs-path';

/** Parent of a root-relative path; the root's children answer `''`. */
function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function join(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/**
 * `path` as it is once `from` has become `to`: itself when it is neither
 * `from` nor inside it.
 */
export function relocatePath(path: string, from: string, to: string): string {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

/**
 * What is wrong with a name typed for a new or renamed entry, or `null`. The
 * backend has the last word — it refuses the same things — but saying so as
 * the name is typed beats a round trip and an error.
 */
export function nameProblem(value: string): string | null {
  const name = value.trim();
  if (name === '') {
    return 'A file or folder name must be provided.';
  }
  if (name === '.' || name === '..') {
    return `'${name}' is not a valid name. Please choose a different name.`;
  }
  if (/[/\\]/.test(name)) {
    return "A name cannot contain '/' or '\\'.";
  }
  return null;
}

/** The part of a name a rename box selects: all of it but the extension — `report` of `report.pdf`. */
function stemRange(name: string): readonly [number, number] {
  const dot = name.lastIndexOf('.');
  return [0, dot > 0 ? dot : name.length];
}

/**
 * Renaming, and new folders and files (PRD 003, §5) — each a single request
 * to the backend, asked for in a modal window the way VS Code asks for a
 * name, with the name checked as it is typed.
 *
 * Whatever the change touches follows it: a renamed entry stays selected
 * under its new name, a panel or tab showing a renamed folder — or anything in
 * it — keeps showing it, and so do the clipboard and the details sidebar. A
 * new entry is selected once its folder has been read again, and the keyboard
 * lands on it. Each change is recorded with `UndoFeature`.
 */
export class FileEditFeature {
  constructor(private readonly parent: WorkbenchService) {}

  /**
   * Asks for a new name for `path` and renames it. A name that is taken is
   * asked for again, with the reason; an unchanged name does nothing.
   */
  async rename(path: string, groupId: string | null = null): Promise<void> {
    if (path === '') {
      return;
    }
    const current = nameOf(path);
    let value = current;
    let problem: string | null = null;
    for (;;) {
      const answer = await this.parent.modal.prompt({
        message: `Rename '${current}' to:`,
        ...(problem === null ? {} : { detail: problem }),
        label: 'New name',
        value,
        selection: stemRange(value),
        confirmLabel: 'Rename',
        validate: nameProblem,
      });
      if (answer === null || answer.trim() === current) {
        return;
      }
      value = answer.trim();
      const to = join(parentOf(path), value);
      try {
        await this.parent.fileSystem.editFt.rename(path, to);
      } catch (error) {
        problem = await this.explain(error, value, 'rename');
        if (problem === null) {
          return;
        }
        continue;
      }
      await this.renamed(path, to, groupId);
      this.parent.undoFt.record({
        label: 'Rename',
        undo: async () => {
          await this.parent.fileSystem.editFt.rename(to, path);
          await this.renamed(to, path, null);
        },
      });
      return;
    }
  }

  /** Asks for a name, and makes an empty folder of it in `folder`. */
  createFolder(folder: string, groupId: string | null = null): Promise<void> {
    return this.create('folder', folder, groupId);
  }

  /** Asks for a name, and makes an empty file of it in `folder`. */
  createFile(folder: string, groupId: string | null = null): Promise<void> {
    return this.create('file', folder, groupId);
  }

  /**
   * Everything that knew an entry by its old path now knows it by the new one:
   * panels and their tabs, selections, the clipboard, the details sidebar and
   * the explorer. Then the folders involved are read again, and the entry is
   * selected where it now is. Also what Undo of a move calls, per entry.
   */
  async renamed(from: string, to: string, groupId: string | null): Promise<void> {
    this.relocate(from, to);
    const folders = new Set([parentOf(from), parentOf(to)]);
    await Promise.all([...folders].map((folder) => this.parent.fsDataFt.reloadListing(folder)));
    if (groupId !== null) {
      this.selectIn(groupId, to);
    }
  }

  private async create(kind: 'file' | 'folder', folder: string, groupId: string | null): Promise<void> {
    let value = kind === 'folder' ? 'New Folder' : 'New File.txt';
    let problem: string | null = null;
    const where = folder === '' ? '/' : shownPath(folder);
    for (;;) {
      const answer = await this.parent.modal.prompt({
        message: kind === 'folder' ? `New folder in '${where}':` : `New file in '${where}':`,
        ...(problem === null ? {} : { detail: problem }),
        label: kind === 'folder' ? 'Folder name' : 'File name',
        value,
        selection: kind === 'folder' ? [0, value.length] : stemRange(value),
        confirmLabel: 'Create',
        validate: nameProblem,
      });
      if (answer === null) {
        return;
      }
      value = answer.trim();
      let created: FsDetails;
      try {
        const edit = this.parent.fileSystem.editFt;
        created = await (kind === 'folder' ? edit.createFolder(folder, value) : edit.createFile(folder, value));
      } catch (error) {
        problem = await this.explain(error, value, kind === 'folder' ? 'create the folder' : 'create the file');
        if (problem === null) {
          return;
        }
        continue;
      }
      await this.parent.fsDataFt.reloadListing(folder);
      if (groupId !== null) {
        this.selectIn(groupId, created.path);
      }
      this.parent.undoFt.record({
        label: kind === 'folder' ? 'New Folder' : 'New File',
        // Undone into the trash rather than deleted: whatever was put in it since is not lost.
        undo: () => this.parent.operationsFt.trashQuietly([created.path]),
      });
      return;
    }
  }

  /**
   * Why a name was refused, for asking again — or `null` when asking again
   * would not help, in which case the reason has been shown.
   */
  private async explain(error: unknown, name: string, action: string): Promise<string | null> {
    const failure = FsError.from(error);
    if (failure.code === 'CONFLICT') {
      return `A file or folder '${name}' already exists here. Please choose a different name.`;
    }
    if (failure.code === 'BAD_REQUEST') {
      return failure.message;
    }
    await this.parent.modal.message({ severity: 'error', message: `Could not ${action} '${name}'.`, detail: failure.message });
    return null;
  }

  /** Selects `path` in a panel showing its folder, and puts the keyboard on it. */
  private selectIn(groupId: string, path: string): void {
    const group = this.parent.editorGroupsFt.stateOf(groupId);
    if (group === undefined || group.path !== parentOf(path)) {
      return;
    }
    this.parent.fileBrowserFt.selectEntry(groupId, path);
    this.parent.panelFocusFt.focusBody(groupId);
  }

  private relocate(from: string, to: string): void {
    const move = (path: string): string => relocatePath(path, from, to);
    const groups = this.parent.editorGroupsFt;
    for (const group of groups.states()) {
      const touched =
        move(group.path) !== group.path ||
        group.tabs.some((tab) => move(tab.path) !== tab.path) ||
        group.selection.some((path) => move(path) !== path) ||
        (group.focusedEntryId !== undefined && move(group.focusedEntryId) !== group.focusedEntryId);
      if (!touched) {
        continue;
      }
      groups.update(group.id, (state) => ({
        ...state,
        path: move(state.path),
        tabs: state.tabs.map((tab) =>
          move(tab.path) === tab.path ? tab : { ...tab, path: move(tab.path), label: tab.path === from ? nameOf(to) : tab.label },
        ),
        selection: state.selection.map(move),
        ...(state.focusedEntryId === undefined ? {} : { focusedEntryId: move(state.focusedEntryId) }),
      }));
      const moved = groups.stateOf(group.id);
      const active = moved ? groups.activeTabOf(moved) : undefined;
      if (active !== undefined) {
        this.parent.fileBrowserFt.load(active);
      }
    }
    this.parent.fileClipboardFt.relocate(move);
    this.parent.folderViewsFt.relocate(move);
    this.parent.explorerFt.relocate(move);
    const selected = this.parent.selectedEntryId();
    if (move(selected) !== selected) {
      this.parent.select(move(selected));
    }
  }
}
