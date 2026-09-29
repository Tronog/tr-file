import { signal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/**
 * One stop on a panel's trail: the folder, and — once the panel has left it —
 * what was selected there and where the cursor was (PRD 002, §2.1), so that
 * coming back puts them back.
 */
interface HistoryStop {
  readonly path: string;
  readonly selection: readonly string[];
  readonly focused?: string;
}

/** Where one panel has been, and where it is in that list. */
interface PanelHistory {
  /** Folders visited, oldest first. */
  readonly entries: readonly HistoryStop[];
  /** Index of the folder the panel is showing; `-1` before anything is known. */
  readonly index: number;
}

const EMPTY: PanelHistory = { entries: [], index: -1 };

/**
 * Each panel's own trail of folders, and `Alt`+`←`/`→` along it
 * (PRD 001, §6.2.1; PRD 002, §2.1) — each stop with the selection and the
 * cursor the panel had there, put back when Back or Forward returns to it.
 *
 * Per panel, not per window: two panels side by side are two places someone is
 * working, and going back in one must not move the other. The history is
 * therefore keyed by group id, and a group that is closed takes its trail with
 * it.
 *
 * It behaves the way a browser's does. Visiting a folder truncates whatever
 * lay ahead and appends — so going back three folders and then somewhere new
 * abandons the forward trail, rather than leaving a branch nobody can see.
 *
 * The one subtlety is how a history-driven move is kept out of the history it
 * is walking. Rather than a flag that has to be set and cleared around every
 * navigation, `record` simply notices that the panel has landed where the
 * cursor already points and does nothing: going back to `A` cannot append `A`,
 * because `A` is what the cursor now names. That also de-duplicates a folder
 * opened twice in a row, which is the same non-event.
 *
 * What was selected is kept by `leave`, which the panel calls just before it
 * goes elsewhere — the moment the folder's selection is about to be cleared —
 * and restored by `go` once the panel is back. An empty folder keeps an empty
 * selection, and restores nothing: the panel's body then takes the keyboard,
 * as it does for any empty folder.
 */
export class PanelHistoryFeature {
  private readonly histories = signal<Readonly<Record<string, PanelHistory>>>({});

  constructor(private readonly parent: WorkbenchService) {}

  /**
   * The panel landed on a folder.
   *
   * Called by `EditorGroupsFeature` for every navigation, including the ones
   * this feature causes — see the note above on why that is safe.
   */
  record(groupId: string, path: string): void {
    const history = this.historyOf(groupId);
    if (history.entries[history.index]?.path === path) {
      return;
    }

    const entries = [...history.entries.slice(0, history.index + 1), { path, selection: [] }];
    this.histories.update((all) => ({
      ...all,
      [groupId]: { entries, index: entries.length - 1 },
    }));
  }

  /**
   * The panel is about to leave the folder it shows: what is selected there,
   * and the cursor, are kept on its stop for Back or Forward to put back.
   */
  leave(groupId: string): void {
    const group = this.parent.editorGroupsFt.stateOf(groupId);
    const history = this.historyOf(groupId);
    const stop = history.entries[history.index];
    if (group === undefined || stop === undefined || stop.path !== group.path) {
      return;
    }
    const kept: HistoryStop = {
      path: stop.path,
      selection: group.selection,
      ...(group.focusedEntryId !== undefined && this.isIn(group.focusedEntryId, stop.path) ? { focused: group.focusedEntryId } : {}),
    };
    const entries = history.entries.map((entry, index) => (index === history.index ? kept : entry));
    this.histories.update((all) => ({ ...all, [groupId]: { ...history, entries } }));
  }

  /** A closed panel takes its trail with it. */
  forget(groupId: string): void {
    if (this.histories()[groupId] === undefined) {
      return;
    }
    this.histories.update((all) => {
      const { [groupId]: _removed, ...rest } = all;
      return rest;
    });
  }

  /** Whether there is anywhere to go back to. */
  canGoBack(groupId: string): boolean {
    return this.historyOf(groupId).index > 0;
  }

  /** Whether the panel has been sent back and can return. */
  canGoForward(groupId: string): boolean {
    const history = this.historyOf(groupId);
    return history.index >= 0 && history.index < history.entries.length - 1;
  }

  /** `Alt`+`←`: the folder this panel was showing before. */
  back(groupId: string): void {
    this.go(groupId, -1);
  }

  /** `Alt`+`→`: undoes a back, while there is one to undo. */
  forward(groupId: string): void {
    this.go(groupId, 1);
  }

  /** The trail of a panel, for tests and for anything that wants to show it. */
  entriesOf(groupId: string): readonly string[] {
    return this.historyOf(groupId).entries.map((entry) => entry.path);
  }

  private go(groupId: string, step: -1 | 1): void {
    const history = this.historyOf(groupId);
    const stop = history.entries[history.index + step];
    if (stop === undefined) {
      return;
    }

    // `navigateTo` keeps what is selected here on this stop (`leave`); then
    // the cursor moves, so the navigation lands on the folder it already
    // names and `record` correctly does nothing.
    this.leave(groupId);
    this.histories.update((all) => {
      const current = all[groupId] ?? EMPTY;
      return { ...all, [groupId]: { ...current, index: history.index + step } };
    });
    this.parent.fileBrowserFt.navigateTo(groupId, stop.path, this.labelFor(stop.path));

    // Back where it was: the selection and the cursor it had here (PRD 002, §2.1).
    if (stop.selection.length > 0 || stop.focused !== undefined) {
      this.parent.fileBrowserFt.setSelection(groupId, { selected: stop.selection, focused: stop.focused ?? null });
    }
  }

  /** Whether `entryId` is in the folder `path` — or under it, as a tree view shows. */
  private isIn(entryId: string, path: string): boolean {
    return path === '' ? entryId !== '' : entryId.startsWith(`${path}/`);
  }

  private historyOf(groupId: string): PanelHistory {
    return this.histories()[groupId] ?? EMPTY;
  }

  /** The workspace name at the root, else the folder's own name. */
  private labelFor(path: string): string {
    return path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path);
  }
}
