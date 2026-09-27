import { computed, signal } from '@angular/core';
import type { UiIconAction, UiTreeNode } from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import { isFolder } from '../../file-system/fs-entry-kind';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

/** How long typing has to pause before a search starts: a walk of the disk per key would be wasteful. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The most results one search brings back; the backend says when there were more. */
const RESULT_LIMIT = 500;

type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * The Search view (PRD 003, §5): the activity bar's magnifier, or
 * `Ctrl`+`Shift`+`F`, turns the left sidebar into a search of the file
 * system by name — VS Code's search, for names rather than contents.
 *
 * What was typed is looked for everywhere under the scope — the whole
 * workspace, or the folder the active panel shows — as a substring, or as a
 * glob with `*` / `?`, shallowest results first. It runs once typing pauses,
 * and an answer that arrives after a newer question was asked is dropped.
 *
 * A result is shown where it lives: a click shows its folder in the active
 * panel, with the entry selected; a double click opens it, as in a listing.
 */
export class SearchFeature {
  private readonly text = signal('');
  private readonly scopeFolder = signal<string | null>(null);
  private readonly found = signal<readonly FsEntry[]>([]);
  private readonly state = signal<SearchStatus>('idle');
  private readonly cutShort = signal(false);
  private readonly failure = signal<string | null>(null);
  private readonly focus = signal(0);
  private readonly picked = signal<string | null>(null);

  /** Which search is the latest; an older answer is not shown. */
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly parent: WorkbenchService) {}

  readonly query = this.text.asReadonly();
  readonly status = this.state.asReadonly();
  readonly error = this.failure.asReadonly();
  /** Bumped to put the keyboard in the search box. */
  readonly focusToken = this.focus.asReadonly();

  /** Where the search looks: `null` is the whole workspace. */
  readonly scope = this.scopeFolder.asReadonly();

  /** `in /docs`, or `in the whole workspace`. */
  readonly scopeLabel = computed(() => {
    const folder = this.scopeFolder();
    return folder === null || folder === '' ? 'In the whole workspace' : `In /${folder}`;
  });

  /** The pane header's buttons: scope to the active panel's folder or widen it, and run again. */
  readonly actions = computed<readonly UiIconAction[]>(() => [
    {
      id: 'scope',
      label: this.scopeFolder() === null ? "Search only the active panel's folder" : 'Search the whole workspace',
      icon: 'folder',
      ...(this.scopeFolder() === null ? {} : { active: true }),
    },
    { id: 'refresh', label: 'Search again', icon: 'refresh' },
    { id: 'clear', label: 'Clear search results', icon: 'x' },
  ]);

  /** `12 results`, `No results`, `Showing the first 500 results` — or nothing before a search. */
  readonly summary = computed(() => {
    const count = this.found().length;
    switch (this.state()) {
      case 'idle':
        return null;
      case 'searching':
        return count === 0 ? 'Searching…' : `Searching… ${count} so far`;
      case 'error':
        return null;
      case 'done':
        if (count === 0) {
          return 'No results. Try a shorter name, or *.ext for a kind of file.';
        }
        return this.cutShort()
          ? `Showing the first ${count} results — narrow the search to see the rest`
          : `${count} ${count === 1 ? 'result' : 'results'}`;
    }
  });

  /** The results as rows of a flat tree: the name, and the folder it is in beside it. */
  readonly nodes = computed<readonly UiTreeNode[]>(() => {
    const files = this.parent.fileViewModel;
    const picked = this.picked();
    return this.found().map((entry) => ({
      id: entry.path,
      label: entry.name,
      depth: 0,
      icon: files.icon(entry),
      tint: files.tint(entry),
      expandable: false,
      meta: `/${parentOf(entry.path)}`,
      guides: [],
      ...(entry.hidden ? { decoration: 'ignored' as const } : {}),
      ...(entry.path === picked ? { selected: true, focused: true } : {}),
    }));
  });

  /** `Ctrl`+`Shift`+`F`, from anywhere in the workbench. */
  handleShortcut(event: KeyboardEvent): void {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f' && !this.parent.modal.isOpen()) {
      event.preventDefault();
      this.show();
    }
  }

  /** Shows the Search view, with the keyboard in its box. */
  show(): void {
    this.parent.chromeFt.showSidebar('search');
    this.focus.update((token) => token + 1);
  }

  /** What was typed; a search follows once typing pauses. */
  setQuery(value: string): void {
    this.text.set(value);
    this.schedule();
  }

  /** `Enter` in the box: search now rather than after the pause. */
  searchNow(): void {
    this.cancelTimer();
    void this.search();
  }

  runAction(id: string): void {
    switch (id) {
      case 'scope':
        this.scopeFolder.set(this.scopeFolder() === null ? (this.parent.editorGroupsFt.pathOf(this.parent.activeGroupId()) ?? '') : null);
        this.searchNow();
        break;
      case 'refresh':
        this.searchNow();
        break;
      case 'clear':
        this.clear();
        break;
    }
  }

  clear(): void {
    this.cancelTimer();
    this.sequence += 1;
    this.text.set('');
    this.found.set([]);
    this.failure.set(null);
    this.picked.set(null);
    this.state.set('idle');
  }

  /** A click on a result: its folder in the active panel, with the result selected there. */
  reveal(path: string): void {
    this.picked.set(path);
    const groupId = this.parent.activeGroupId();
    const folder = parentOf(path);
    const browser = this.parent.fileBrowserFt;
    browser.openFolder(groupId, folder, folder === '' ? this.parent.workspaceName() : (folder.split('/').at(-1) ?? folder));
    browser.selectEntry(groupId, path);
  }

  /** A double click: opened, as a double click in a listing opens it. */
  open(path: string): void {
    this.picked.set(path);
    const entry = this.found().find((candidate) => candidate.path === path);
    if (entry !== undefined && isFolder(entry)) {
      const groupId = this.parent.activeGroupId();
      this.parent.fileBrowserFt.openFolder(groupId, path, entry.name);
      this.parent.panelFocusFt.focusBody(groupId);
      return;
    }
    this.reveal(path);
    this.parent.fileBrowserFt.openPath(this.parent.activeGroupId(), path);
  }

  private schedule(): void {
    this.cancelTimer();
    if (this.text().trim() === '') {
      this.clear();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.search();
    }, SEARCH_DEBOUNCE_MS);
  }

  private async search(): Promise<void> {
    const query = this.text().trim();
    if (query === '') {
      this.clear();
      return;
    }
    const sequence = ++this.sequence;
    this.state.set('searching');
    this.failure.set(null);
    try {
      const result = await this.parent.fileSystem.readFt.search(this.scopeFolder() ?? '', query, RESULT_LIMIT);
      if (sequence !== this.sequence) {
        return;
      }
      this.found.set(result.entries);
      this.cutShort.set(result.truncated);
      this.state.set('done');
    } catch (error) {
      if (sequence !== this.sequence) {
        return;
      }
      this.found.set([]);
      this.failure.set(FsError.from(error).message);
      this.state.set('error');
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
