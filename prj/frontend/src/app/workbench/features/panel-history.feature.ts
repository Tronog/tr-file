import { signal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/** Where one panel has been, and where it is in that list. */
interface PanelHistory {
  /** Folders visited, oldest first. */
  readonly entries: readonly string[];
  /** Index of the folder the panel is showing; `-1` before anything is known. */
  readonly index: number;
}

const EMPTY: PanelHistory = { entries: [], index: -1 };

/**
 * Each panel's own trail of folders, and `Alt`+`←`/`→` along it
 * (PRD 001, §6.2.1).
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
    if (history.entries[history.index] === path) {
      return;
    }

    const entries = [...history.entries.slice(0, history.index + 1), path];
    this.histories.update((all) => ({
      ...all,
      [groupId]: { entries, index: entries.length - 1 },
    }));
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
    return this.historyOf(groupId).entries;
  }

  private go(groupId: string, step: -1 | 1): void {
    const history = this.historyOf(groupId);
    const index = history.index + step;
    const path = history.entries[index];
    if (path === undefined) {
      return;
    }

    // The cursor moves first, so the navigation below lands on the folder it
    // already names and `record` correctly does nothing.
    this.histories.update((all) => ({ ...all, [groupId]: { ...history, index } }));
    this.parent.fileBrowserFt.navigateTo(groupId, path, this.labelFor(path));
  }

  private historyOf(groupId: string): PanelHistory {
    return this.histories()[groupId] ?? EMPTY;
  }

  /** The workspace name at the root, else the folder's own name. */
  private labelFor(path: string): string {
    return path === '' ? this.parent.workspaceName() : (path.split('/').at(-1) ?? path);
  }
}
