import { computed, signal } from '@angular/core';
import type { UiBreadcrumb, UiDiffLine, UiDocumentModel, UiEmptyStateModel, UiFileBrowserModel, UiIconAction } from '@tr-file/ui';
import type { FsGitDiff } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { PanelContentFeature } from '../panel-content.model';
import { PANEL_CONTENT, type PanelGroupState, type PanelTabState } from '../panel-group.model';
import type { WorkbenchService } from '../workbench.service';

interface DiffState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly diff?: FsGitDiff;
  readonly error?: FsError;
}

const joinRoot = (root: string, file: string): string => (root === '' ? file : `${root}/${file}`);
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A file's changes, in a panel tab of their own (PRD 011, §1) — what
 * choosing a change in the Git pane opens, as VS Code opens a diff editor.
 *
 * The tab (`kind: 'diff'`) keeps the repository, the file inside it and
 * which side: the staged changes, or those not staged yet. The diff is read
 * when the tab is shown, again on Refresh, and after every change made from
 * the Git pane; a reload keeps the old one on screen until the new one
 * lands. It is drawn by `UiFileBrowser` as a read-only `diff` document, with
 * Refresh, Open File and Stage / Unstage on its toolbar.
 */
export class GitDiffFeature implements PanelContentFeature {
  private readonly states = signal<Readonly<Record<string, DiffState>>>({});

  constructor(private readonly parent: WorkbenchService) {}

  /* -- panel content ------------------------------------------------------------ */

  load(tab: PanelTabState): void {
    this.read(tab, false);
  }

  isLoading(_group: PanelGroupState, tab: PanelTabState): boolean {
    const state = this.stateOf(tab);
    return state?.status === 'loading' && state.diff === undefined;
  }

  acceptsFiles(): boolean {
    return false;
  }

  /* -- opening -------------------------------------------------------------------- */

  /** Opens a file's staged or unstaged changes in the active group, or goes back to the tab that has them. */
  open(root: string, file: string, staged: boolean): void {
    const groups = this.parent.editorGroupsFt;
    const groupId = this.parent.activeGroupId();
    const group = groups.stateOf(groupId);
    if (group === undefined) {
      return;
    }
    const path = joinRoot(root, file);
    const existing = group.tabs.find((tab) => tab.kind === 'diff' && tab.path === path && tab.diff?.staged === staged);
    const tab: PanelTabState = existing ?? {
      id: `tab-diff-${groups.createId()}`,
      label: `${nameOf(file)} (${staged ? 'Index' : 'Working Tree'})`,
      path,
      kind: 'diff',
      diff: { root, file, staged },
    };
    groups.setTabs(groupId, existing ? group.tabs : [...group.tabs, tab], tab.id);
    groups.focus(groupId);
    this.read(tab, existing !== undefined);
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** Every diff on screen, read again — the Git pane changed the repository. */
  reloadAll(): void {
    for (const group of this.parent.editorGroupsFt.states()) {
      const tab = this.parent.editorGroupsFt.activeTabOf(group);
      if (tab?.kind === 'diff') {
        this.read(tab, true);
      }
    }
  }

  /* -- the view --------------------------------------------------------------------- */

  readonly browsersById = computed<Readonly<Record<string, UiFileBrowserModel>>>(() => {
    const groups = this.parent.editorGroupsFt;
    const entries = groups.states().flatMap((group) => {
      const tab = groups.activeTabOf(group);
      return tab && PANEL_CONTENT[tab.kind] === 'diff' ? [[group.id, this.toViewModel(tab)] as const] : [];
    });
    return Object.fromEntries(entries);
  });

  browser(groupId: string): UiFileBrowserModel | undefined {
    return this.browsersById()[groupId];
  }

  runToolbarAction(groupId: string, actionId: string): void {
    const tab = this.tabOf(groupId);
    const spec = tab?.diff;
    if (tab === undefined || spec === undefined) {
      return;
    }
    switch (actionId) {
      case 'refresh':
        this.read(tab, true);
        break;
      case 'open-file':
        this.parent.fileBrowserFt.openPath(groupId, tab.path);
        break;
      case 'stage':
      case 'unstage': {
        const git = this.parent.gitFt;
        const change = git.repository()?.changes.find(
          (candidate) => candidate.file === spec.file && (actionId === 'unstage' ? candidate.area === 'staged' : candidate.area !== 'staged'),
        );
        void (change === undefined ? Promise.resolve(false) : actionId === 'stage' ? git.stage([change]) : git.unstage([change]));
        break;
      }
      default:
        break;
    }
  }

  /** A crumb: the folders above the file; the file's own crumb stays. */
  openBreadcrumb(groupId: string, crumbId: string): void {
    if (crumbId !== this.tabOf(groupId)?.path) {
      this.parent.fileBrowserFt.openBreadcrumb(groupId, crumbId);
    }
  }

  /** The keys a panel reports, as far as a diff has a meaning for them. */
  runKey(groupId: string, command: string): void {
    if (command === 'refresh') {
      this.runToolbarAction(groupId, 'refresh');
    }
  }

  /* -- internals ---------------------------------------------------------------------- */

  private read(tab: PanelTabState, again: boolean): void {
    const spec = tab.diff;
    if (spec === undefined) {
      return;
    }
    const key = GitDiffFeature.key(tab);
    const current = this.states()[key];
    if (current !== undefined && !again && current.status !== 'error') {
      return;
    }
    this.patch(key, { status: 'loading', ...(current?.diff ? { diff: current.diff } : {}) });
    this.parent.fileSystem.gitFt.diff(spec.root, spec.file, spec.staged).then(
      (diff) => this.patch(key, { status: 'ready', diff }),
      (error: unknown) => this.patch(key, { status: 'error', error: FsError.from(error) }),
    );
  }

  private patch(key: string, state: DiffState): void {
    this.states.update((all) => ({ ...all, [key]: state }));
  }

  private stateOf(tab: PanelTabState): DiffState | undefined {
    return this.states()[GitDiffFeature.key(tab)];
  }

  private tabOf(groupId: string): PanelTabState | undefined {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    const tab = group === undefined ? undefined : groups.activeTabOf(group);
    return tab?.kind === 'diff' ? tab : undefined;
  }

  private toViewModel(tab: PanelTabState): UiFileBrowserModel {
    const state = this.stateOf(tab);
    const staged = tab.diff?.staged ?? false;
    const toolbar: readonly UiIconAction[] = [
      { id: 'refresh', label: 'Read the changes again', icon: 'refresh' },
      { id: 'open-file', label: 'Open File', icon: 'file-text' },
      staged ? { id: 'unstage', label: 'Unstage Changes', icon: 'minus' } : { id: 'stage', label: 'Stage Changes', icon: 'plus' },
    ];
    const diff = state?.diff;
    const lines = diff === undefined ? [] : GitDiffFeature.parse(diff.text);
    const added = lines.filter((line) => line.kind === 'add').length;
    const removed = lines.filter((line) => line.kind === 'remove').length;
    const document: UiDocumentModel | undefined =
      diff === undefined || diff.binary || diff.text === ''
        ? undefined
        : {
            path: `${tab.path} · ${staged ? 'staged changes' : 'changes not staged'}`,
            kind: 'diff',
            lines,
            meta: `+${added} −${removed}${diff.truncated ? ' · cut short' : ''}`,
          };
    return {
      breadcrumbs: this.breadcrumbs(tab.path),
      view: 'list',
      toolbarActions: toolbar,
      columns: [],
      rows: [],
      items: [],
      summary: staged ? 'Staged' : 'Working tree',
      ...(document ? { document } : {}),
      ...this.placeholder(state, staged),
      ...(state === undefined || (state.status === 'loading' && diff === undefined) ? { pending: true } : {}),
    };
  }

  private placeholder(state: DiffState | undefined, staged: boolean): { empty?: UiEmptyStateModel } {
    if (state?.status === 'error' && state.diff === undefined) {
      return { empty: { icon: 'alert-triangle', title: 'Could not read the changes', hint: state.error?.message ?? 'Git refused.' } };
    }
    const diff = state?.diff;
    if (diff?.binary) {
      return { empty: { icon: 'file', title: 'Binary file', hint: 'Git does not show the changes of a binary file line by line.' } };
    }
    if (diff !== undefined && diff.text === '') {
      return {
        empty: {
          icon: 'check',
          title: staged ? 'Nothing staged in this file' : 'No changes left in this file',
          hint: staged ? 'Its changes are not staged, or have been committed.' : 'Its changes are staged, committed, or discarded.',
        },
      };
    }
    return {};
  }

  private breadcrumbs(path: string): readonly UiBreadcrumb[] {
    const segments = path.split('/').filter(Boolean);
    return [
      { id: 'root', label: this.parent.workspaceName(), icon: 'desktop' },
      ...segments.map((label, index) => ({ id: segments.slice(0, index + 1).join('/'), label })),
    ];
  }

  /** A unified diff, line by line, each said what it is. */
  static parse(text: string): readonly UiDiffLine[] {
    const raw = text.endsWith('\n') ? text.slice(0, -1) : text;
    if (raw === '') {
      return [];
    }
    let header = true;
    return raw.split('\n').map((line): UiDiffLine => {
      if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
        header = true;
      }
      if (line.startsWith('@@')) {
        header = false;
        return { kind: 'hunk', text: line };
      }
      if (header || line.startsWith('\\')) {
        return { kind: 'meta', text: line };
      }
      if (line.startsWith('+')) {
        return { kind: 'add', text: line };
      }
      if (line.startsWith('-')) {
        return { kind: 'remove', text: line };
      }
      return { kind: 'context', text: line };
    });
  }

  private static key(tab: PanelTabState): string {
    return `${tab.diff?.root ?? ''}\n${tab.diff?.file ?? tab.path}\n${tab.diff?.staged === true ? 'staged' : 'unstaged'}`;
  }
}
