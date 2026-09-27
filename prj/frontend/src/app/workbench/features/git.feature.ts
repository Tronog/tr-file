import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type {
  UiIconAction,
  UiQuickPickItem,
  UiScmActionEvent,
  UiScmCommit,
  UiScmGroup,
  UiScmItem,
  UiScmModel,
  UiScmTone,
} from '@tr-file/ui';
import type {
  FsGitChange,
  FsGitChangeKind,
  FsGitInfo,
  FsGitLog,
  FsGitRepository,
  FsGitStatus,
  FsGitWriteAction,
} from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { InputStep, PickStep } from './command-palette.feature';
import type { WorkbenchService } from '../workbench.service';

/** Commits the log shows at first, and each *Load more* adds. */
const LOG_PAGE = 30;

/** The pick list's row for a new branch, above the branches. */
const NEW_BRANCH = 'git.new-branch';

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Git's letter for a change, as VS Code draws it. */
const LETTERS: Readonly<Record<FsGitChangeKind, string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: 'U',
  conflict: '!',
};

const KIND_LABELS: Readonly<Record<FsGitChangeKind, string>> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  'type-changed': 'Type changed',
  untracked: 'Untracked',
  conflict: 'Conflict',
};

const TONES: Readonly<Record<FsGitChangeKind, UiScmTone>> = {
  modified: 'modified',
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'added',
  'type-changed': 'modified',
  untracked: 'untracked',
  conflict: 'conflict',
};

/** What a running action is called while it runs. */
const RUNNING: Readonly<Partial<Record<FsGitWriteAction, string>>> = {
  commit: 'Committing',
  fetch: 'Fetching',
  pull: 'Pulling',
  push: 'Pushing',
  checkout: 'Checking out',
  stash: 'Stashing',
  'stash-pop': 'Applying stash',
  init: 'Creating repository',
};

/** Actions after which files on disk may have changed, and the listings on screen are read again. */
const TOUCHES_FILES: ReadonlySet<FsGitWriteAction> = new Set<FsGitWriteAction>(['discard', 'checkout', 'pull', 'stash', 'stash-pop', 'init']);

/**
 * Git in the details sidebar (PRD 011, §1): the repository the active
 * panel's folder is in — found by the backend, which looks for a `.git` in
 * it and the folders above it — and what developers do with it every day.
 *
 * It keeps the status, the log and the draft commit message of each
 * repository, and turns them into the `UiScmModel` the library's
 * `UiSourceControl` draws. Every change goes through `FsGitFeature` and
 * answers with the repository's new status. Git is optional: where the
 * backend has none, or the folder is in no repository, there is no pane —
 * *Git: Initialize Repository* in the palette makes one.
 *
 * It follows the active panel on its own: when the folder shown changes, the
 * status is read again — keeping the old one on screen until the new one
 * lands — as it is when the window regains focus and when auto-refresh sees
 * the repository's `.git` change, which is how a commit made in a terminal
 * shows up. Nothing is asked before `start`.
 */
export class GitFeature {
  private readonly infoState = signal<FsGitInfo | null>(null);
  private readonly statusState = signal<FsGitStatus | null>(null);
  private readonly logState = signal<FsGitLog | null>(null);
  private readonly logLimit = signal(LOG_PAGE);
  private readonly running = signal<string | null>(null);
  private readonly problem = signal<string | null>(null);
  /** Draft commit messages, by repository root: switching folders keeps what was typed. */
  private readonly drafts = signal<ReadonlyMap<string, string>>(new Map());
  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());
  private readonly focusToken = signal(0);
  private readonly started = signal(false);

  private loading: Promise<void> | null = null;
  private again = false;
  /** What the log was last read for: a new repository, or a new HEAD, reads it again. */
  private logFor: string | null = null;

  constructor(private readonly parent: WorkbenchService) {
    effect(() => {
      if (!this.started()) {
        return;
      }
      this.folder();
      untracked(() => void this.refresh());
    });
    const onFocus = (): void => void this.refresh();
    globalThis.window?.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => globalThis.window?.removeEventListener('focus', onFocus));
  }

  /**
   * Starts following the active panel. Called by the workbench component
   * once it is up — not by `WorkbenchService.start`, so a service made for a
   * test asks nothing of git.
   */
  start(): void {
    this.started.set(true);
  }

  /* -- what is shown ------------------------------------------------------------ */

  /**
   * The folder whose repository is shown: the active panel's — or, for a
   * file, a zip or a diff, the folder it is in.
   */
  readonly folder = computed<string | null>(() => {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(this.parent.activeGroupId());
    const tab = group === undefined ? undefined : groups.activeTabOf(group);
    if (tab === undefined) {
      return null;
    }
    if (tab.kind === 'folder') {
      return tab.path;
    }
    return tab.diff?.root ?? parentOf(tab.path);
  });

  /** The repository shown — the last one read, kept while the next is on its way. */
  readonly repository = computed<FsGitRepository | null>(() => this.statusState()?.repository ?? null);

  readonly available = computed(() => this.infoState()?.available === true);

  readonly busy = computed(() => this.running() !== null);

  /** Whether the shown folder can be made a repository: git is there, and it is in none. */
  readonly canInit = computed(
    () => this.available() && this.statusState() !== null && this.repository() === null && this.folder() !== null && !this.busy(),
  );

  /**
   * Whether the Git pane is there at all (PRD 011, §2.1): only while the
   * folder shown is in a repository. Git missing, switched off, or no
   * repository — the sidebar simply has no Git pane.
   */
  readonly visible = computed(() => this.repository() !== null);

  /** The pane header's buttons. */
  readonly paneActions = computed<readonly UiIconAction[]>(() => {
    const repository = this.repository() !== null;
    const busy = this.busy();
    return [
      { id: 'commit', label: 'Commit (Ctrl+Enter)', icon: 'check', disabled: !repository || busy || !this.canCommit() },
      { id: 'refresh', label: 'Refresh', icon: 'refresh', disabled: busy || !this.available() },
      { id: 'more', label: 'More Actions…', icon: 'dots', disabled: !this.available() },
    ];
  });

  private readonly message = computed(() => {
    const root = this.repository()?.root;
    return root === undefined ? '' : (this.drafts().get(root) ?? '');
  });

  private readonly staged = computed(() => this.repository()?.changes.filter((change) => change.area === 'staged') ?? []);

  private readonly conflicts = computed(() => this.repository()?.changes.filter((change) => change.area === 'conflict') ?? []);

  /** Changes and new files: what *Stage All* and *Discard All* are about. */
  private readonly unstaged = computed(
    () => this.repository()?.changes.filter((change) => change.area === 'unstaged' || change.area === 'untracked') ?? [],
  );

  /** A message, something to commit — staged, or to be staged when asked — and no conflict left. */
  readonly canCommit = computed(
    () =>
      this.message().trim() !== '' &&
      this.conflicts().length === 0 &&
      (this.staged().length > 0 || this.unstaged().length > 0 || this.repository()?.operation === 'merge'),
  );

  /** The view the library draws; `null` without a repository. */
  readonly scm = computed<UiScmModel | null>(() => {
    const repository = this.repository();
    if (repository === null) {
      return null;
    }
    const collapsed = this.collapsedGroups();
    const groups: UiScmGroup[] = [];
    const conflicts = this.conflicts();
    const staged = this.staged();
    const unstaged = this.unstaged();
    const truncated = repository.truncated ? 'Too many changes: only the first few thousand are listed.' : undefined;
    if (conflicts.length > 0) {
      groups.push({
        id: 'conflict',
        label: 'Merge Changes',
        items: conflicts.map((change) => this.item(change)),
        actions: [{ id: 'stage-all', label: 'Stage All Merge Changes', icon: 'plus' }],
        ...(collapsed.has('conflict') ? { collapsed: true } : {}),
      });
    }
    if (staged.length > 0) {
      groups.push({
        id: 'staged',
        label: 'Staged Changes',
        items: staged.map((change) => this.item(change)),
        actions: [{ id: 'unstage-all', label: 'Unstage All Changes', icon: 'minus' }],
        ...(collapsed.has('staged') ? { collapsed: true } : {}),
      });
    }
    if (unstaged.length > 0) {
      groups.push({
        id: 'unstaged',
        label: 'Changes',
        items: unstaged.map((change) => this.item(change)),
        actions: [
          { id: 'discard-all', label: 'Discard All Changes', icon: 'arrow-back-up' },
          { id: 'stage-all', label: 'Stage All Changes', icon: 'plus' },
        ],
        ...(collapsed.has('unstaged') ? { collapsed: true } : {}),
        ...(truncated ? { note: truncated } : {}),
      });
    }

    const branch = repository.branch ?? (repository.head === null ? 'No commits yet' : `${repository.head} (detached)`);
    const log = this.logState();
    return {
      branch,
      branchTitle: `${branch} — Checkout to another branch, or create one`,
      ...this.syncOf(repository),
      ...this.noteOf(repository),
      message: this.message(),
      messagePlaceholder: repository.branch === null ? 'Message (Ctrl+Enter to commit)' : `Message (Ctrl+Enter to commit on '${repository.branch}')`,
      commitLabel: staged.length === 0 && unstaged.length > 0 ? 'Commit All' : 'Commit',
      canCommit: this.canCommit(),
      ...(this.busy() ? { busy: true } : {}),
      messageFocus: this.focusToken(),
      groups,
      commits: (log?.root === repository.root ? log.commits : []).map((commit) => this.commitRow(commit)),
      ...(collapsed.has('commits') ? { commitsCollapsed: true } : {}),
      ...(log?.root === repository.root && log.more ? { moreCommits: true } : {}),
      ...(repository.changes.length === 0 ? { clean: 'No changes — the working tree matches the last commit.' } : {}),
    };
  });

  /** The change a row of the view stands for. */
  changeOf(itemId: string): FsGitChange | undefined {
    return this.repository()?.changes.find((change) => GitFeature.idOf(change) === itemId);
  }

  /* -- following the folder -------------------------------------------------------- */

  /**
   * Reads the shown folder's repository again. A read asked for while one is
   * running is made once more after it, so the last answer is always for the
   * folder shown now.
   */
  refresh(): Promise<void> {
    if (!this.started()) {
      return Promise.resolve();
    }
    if (this.loading !== null) {
      this.again = true;
      return this.loading;
    }
    this.loading = this.load().finally(() => {
      this.loading = null;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.loading;
  }

  /**
   * Auto-refresh saw these folders change: the shown repository is read again
   * when any of them is in it — its `.git` included.
   */
  noticeChanges(changed: readonly string[]): void {
    const root = this.repository()?.root;
    if (root !== undefined && changed.some((path) => GitFeature.within(root, path))) {
      void this.refresh();
    }
  }

  /** The folders auto-refresh should watch for git: the repository's `.git`, where commits and checkouts land. */
  watchedFolders(): readonly string[] {
    const root = this.repository()?.root;
    return root === undefined ? [] : [root === '' ? '.git' : `${root}/.git`];
  }

  private async load(): Promise<void> {
    const info = await this.ensureInfo();
    if (!info.available) {
      return;
    }
    const folder = untracked(() => this.folder());
    if (folder === null) {
      this.statusState.set(null);
      return;
    }
    try {
      const status = await this.parent.fileSystem.gitFt.status(folder);
      this.problem.set(null);
      this.apply(status);
    } catch (error) {
      const failure = FsError.from(error);
      if (failure.code === 'GIT_UNAVAILABLE') {
        this.infoState.set({ available: false, version: null, reason: failure.message });
        return;
      }
      // The folder is gone, or unreadable: it is in no repository that can be shown.
      this.statusState.set({ path: folder, repository: null });
      this.problem.set(failure.code === 'NOT_FOUND' || failure.code === 'BAD_REQUEST' ? null : failure.message);
    }
  }

  private async ensureInfo(): Promise<FsGitInfo> {
    const known = this.infoState();
    if (known !== null && known.available) {
      return known;
    }
    let info: FsGitInfo;
    try {
      info = await this.parent.fileSystem.gitFt.info();
    } catch (error) {
      const failure = FsError.from(error);
      // A backend from before git has no such route: no git there.
      info = { available: false, version: null, reason: failure.code === 'NOT_FOUND' ? 'This server does not offer git.' : failure.message };
    }
    this.infoState.set(info);
    return info;
  }

  /** Takes a status in; a new repository or a new HEAD reads the log again. */
  private apply(status: FsGitStatus): void {
    this.statusState.set(status);
    const repository = status.repository;
    if (repository === null) {
      this.logFor = null;
      return;
    }
    const key = `${repository.root}\n${repository.head ?? ''}\n${repository.branch ?? ''}`;
    if (key !== this.logFor) {
      if (this.logFor?.split('\n')[0] !== repository.root) {
        this.logLimit.set(LOG_PAGE);
      }
      this.logFor = key;
      void this.loadLog(repository.root);
    }
  }

  private async loadLog(root: string): Promise<void> {
    try {
      const log = await this.parent.fileSystem.gitFt.log(root, this.logLimit());
      if (this.repository()?.root === root) {
        this.logState.set(log);
      }
    } catch {
      // The log is a nicety: the changes are still shown without it.
    }
  }

  /* -- the view's gestures ---------------------------------------------------------- */

  setMessage(text: string): void {
    const root = this.repository()?.root;
    if (root === undefined) {
      return;
    }
    this.drafts.update((drafts) => new Map(drafts).set(root, text));
  }

  /** Puts the keyboard in the message box — *Git: Commit* from the palette with nothing typed. */
  focusMessage(): void {
    this.parent.sidebarPanesFt.expand('git');
    this.focusToken.update((token) => token + 1);
  }

  toggleGroup(groupId: string): void {
    this.collapsedGroups.update((groups) => {
      const next = new Set(groups);
      if (!next.delete(groupId)) {
        next.add(groupId);
      }
      return next;
    });
  }

  runPaneAction(actionId: string): void {
    switch (actionId) {
      case 'commit':
        void this.commit();
        break;
      case 'refresh':
        void this.refresh();
        break;
      default:
        break;
    }
  }

  /** A row was chosen: its diff, in a tab — or, for a new folder, the folder. */
  openChange(itemId: string): void {
    const change = this.changeOf(itemId);
    const repository = this.repository();
    if (change === undefined || repository === null) {
      return;
    }
    if (change.folder) {
      this.parent.openInActiveGroup(change.path, nameOf(change.path));
      return;
    }
    this.parent.gitDiffFt.open(repository.root, change.file, change.area === 'staged');
  }

  itemAction(event: UiScmActionEvent): void {
    const change = this.changeOf(event.targetId);
    if (change === undefined) {
      return;
    }
    switch (event.actionId) {
      case 'open-file':
        if (change.folder) {
          this.parent.openInActiveGroup(change.path, nameOf(change.path));
        } else {
          this.parent.fileBrowserFt.openPath(this.parent.activeGroupId(), change.path);
        }
        break;
      case 'stage':
        void this.stage([change]);
        break;
      case 'unstage':
        void this.unstage([change]);
        break;
      case 'discard':
        void this.discard([change]);
        break;
      default:
        break;
    }
  }

  groupAction(event: UiScmActionEvent): void {
    switch (`${event.targetId}:${event.actionId}`) {
      case 'conflict:stage-all':
        void this.stage(this.conflicts());
        break;
      case 'staged:unstage-all':
        void this.unstageAll();
        break;
      case 'unstaged:stage-all':
        void this.stageAll();
        break;
      case 'unstaged:discard-all':
        void this.discardAll();
        break;
      default:
        break;
    }
  }

  /** *Load more commits*. */
  moreCommits(): void {
    const root = this.repository()?.root;
    if (root !== undefined) {
      this.logLimit.update((limit) => limit + LOG_PAGE);
      void this.loadLog(root);
    }
  }

  /* -- the everyday changes ------------------------------------------------------------- */

  stage(changes: readonly FsGitChange[]): Promise<boolean> {
    return this.change('stage', { files: GitFeature.filesOf(changes) });
  }

  /** Every change, new files included. */
  stageAll(): Promise<boolean> {
    return this.change('stage', { files: [] });
  }

  unstage(changes: readonly FsGitChange[]): Promise<boolean> {
    return this.change('unstage', { files: GitFeature.filesOf(changes) });
  }

  unstageAll(): Promise<boolean> {
    return this.change('unstage', { files: [] });
  }

  /** Throws changes away, after asking — a new file is deleted, which cannot be undone. */
  async discard(changes: readonly FsGitChange[]): Promise<boolean> {
    if (changes.length === 0) {
      return false;
    }
    const created = changes.filter((change) => change.area === 'untracked');
    const one = changes.length === 1 ? changes[0] : undefined;
    const confirmed = await this.parent.modal.confirm({
      severity: 'warning',
      message:
        one === undefined
          ? `Are you sure you want to discard the changes in ${changes.length} files?`
          : one.area === 'untracked'
            ? `Are you sure you want to DELETE '${nameOf(one.file)}'?`
            : `Are you sure you want to discard the changes in '${nameOf(one.file)}'?`,
      detail:
        created.length > 0
          ? `${created.length === 1 ? 'A file git does not know yet is' : `${created.length} files git does not know yet are`} deleted for good. This is IRREVERSIBLE!`
          : 'Your current changes will be lost. This is IRREVERSIBLE!',
      confirmLabel: created.length > 0 && one !== undefined ? 'Delete File' : 'Discard Changes',
    });
    return confirmed ? this.change('discard', { files: changes.map((change) => change.file) }) : false;
  }

  discardAll(): Promise<boolean> {
    return this.discard(this.unstaged());
  }

  /**
   * Commits what is staged. With nothing staged, asks whether to stage every
   * change and commit that, as VS Code does. The message box empties once
   * the commit is made.
   */
  async commit(amend = false): Promise<boolean> {
    const repository = this.repository();
    if (repository === null || this.busy()) {
      return false;
    }
    const message = this.message();
    if (message.trim() === '' && !amend) {
      this.focusMessage();
      return false;
    }
    let all = false;
    if (!amend && this.staged().length === 0 && repository.operation !== 'merge') {
      if (this.unstaged().length === 0) {
        return false;
      }
      all = await this.parent.modal.confirm({
        message: 'There are no staged changes to commit.',
        detail: 'Would you like to stage all your changes and commit them directly?',
        confirmLabel: 'Stage All and Commit',
      });
      if (!all) {
        return false;
      }
    }
    const done = await this.change('commit', { message, amend, all });
    if (done) {
      this.setMessage('');
    }
    return done;
  }

  fetch(): Promise<boolean> {
    return this.change('fetch');
  }

  pull(): Promise<boolean> {
    return this.change('pull');
  }

  /** Pushes — and publishes a branch that tracks nothing yet. */
  push(): Promise<boolean> {
    return this.change('push');
  }

  /** The sync button: pull what the upstream has, then push what it has not — or publish. */
  async sync(): Promise<boolean> {
    const repository = this.repository();
    if (repository === null) {
      return false;
    }
    if (repository.upstream === null) {
      return this.push();
    }
    if (repository.behind > 0 && !(await this.pull())) {
      return false;
    }
    return (this.repository()?.ahead ?? 0) > 0 ? this.push() : true;
  }

  /** Stashes every change, new files included, with a message if one is given. */
  async stash(): Promise<boolean> {
    const message = await this.parent.modal.prompt({
      message: 'Stash message',
      detail: 'Every change, new files included, is put aside. Leave the message empty for git to name it.',
      placeholder: 'Message (optional)',
      confirmLabel: 'Stash',
    });
    return message === null ? false : this.change('stash', { message });
  }

  popStash(): Promise<boolean> {
    return this.change('stash-pop');
  }

  /** Makes the shown folder a repository. */
  init(): Promise<boolean> {
    return this.change('init');
  }

  /** *Checkout to…*: the branches, local then remote, and a row to make a new one — in the palette. */
  async pickBranch(): Promise<void> {
    const repository = this.repository();
    if (repository === null) {
      return;
    }
    let branches;
    try {
      branches = (await this.parent.fileSystem.gitFt.branches(repository.root)).branches;
    } catch (error) {
      await this.fail('Could not list the branches', error);
      return;
    }
    const palette = this.parent.commandPaletteFt;
    const items: UiQuickPickItem[] = [
      { id: NEW_BRANCH, icon: 'plus', label: 'Create new branch…' },
      ...branches.map((branch) => ({
        id: `branch:${branch.name}`,
        icon: branch.remote ? ('cloud' as const) : ('git-branch' as const),
        label: branch.name,
        description: branch.current ? `current · ${branch.commit}` : branch.remote ? `remote branch · ${branch.commit}` : branch.commit,
      })),
    ];
    const step: PickStep = {
      kind: 'pick',
      label: 'Checkout to branch',
      placeholder: 'Select a branch to checkout, or create a new one',
      items: () => items,
      accept: async (itemId) => {
        if (itemId === NEW_BRANCH) {
          palette.prompt(this.newBranchStep());
          return null;
        }
        const name = itemId.slice('branch:'.length);
        if (branches.find((branch) => branch.name === name)?.current) {
          palette.close();
          return null;
        }
        const failed = await this.attempt('checkout', { branch: name });
        if (failed === null) {
          palette.close();
        }
        return failed;
      },
      button: () => undefined,
    };
    palette.prompt(step);
  }

  /** *Create Branch…*: a name, in the palette, and the new branch checked out. */
  createBranch(): void {
    if (this.repository() !== null) {
      this.parent.commandPaletteFt.prompt(this.newBranchStep());
    }
  }

  /** *Delete Branch…*: a local branch but the current one; one not merged is deleted only after asking again. */
  async deleteBranch(): Promise<void> {
    const repository = this.repository();
    if (repository === null) {
      return;
    }
    let branches;
    try {
      branches = (await this.parent.fileSystem.gitFt.branches(repository.root)).branches.filter((branch) => !branch.remote && !branch.current);
    } catch (error) {
      await this.fail('Could not list the branches', error);
      return;
    }
    const palette = this.parent.commandPaletteFt;
    palette.prompt({
      kind: 'pick',
      label: 'Delete branch',
      placeholder: branches.length === 0 ? 'There is no other branch to delete' : 'Select a branch to delete',
      items: () => branches.map((branch) => ({ id: branch.name, icon: 'git-branch' as const, label: branch.name, description: branch.commit })),
      accept: async (name) => {
        const failed = await this.attempt('branch-delete', { name });
        if (failed === null) {
          palette.close();
          return null;
        }
        palette.close();
        // Not merged anywhere: its commits would be lost, so ask before forcing it.
        const force = await this.parent.modal.confirm({
          severity: 'warning',
          message: `The branch '${name}' could not be deleted.`,
          detail: `${failed}\n\nDelete it anyway? Commits only on it may be lost.`,
          confirmLabel: 'Delete Branch',
        });
        if (force) {
          await this.change('branch-delete', { name, force: true });
        }
        return null;
      },
      button: () => undefined,
    });
  }

  private newBranchStep(): InputStep {
    return {
      kind: 'input',
      label: 'Create branch',
      placeholder: 'Branch name',
      prompt: "Please provide a new branch name. Press 'Enter' to create and check it out, or 'Escape' to cancel.",
      validate: GitFeature.validateBranch,
      accept: (name) => this.attempt('branch-create', { name: name.trim() }),
    };
  }

  /* -- running a change ------------------------------------------------------------------ */

  /** Runs a change and says whether it was made; a refusal is shown in a message window. */
  private async change(action: FsGitWriteAction, fields: Readonly<Record<string, string | boolean | readonly string[]>> = {}): Promise<boolean> {
    const failed = await this.attempt(action, fields);
    if (failed !== null && failed !== '') {
      await this.parent.modal.message({ severity: 'error', message: `Git: ${GitFeature.titleOf(action)} failed`, detail: failed });
    }
    return failed === null;
  }

  /**
   * Runs a change, one at a time, and answers why it could not be made — or
   * `null` when it was. Takes the new status in, and re-reads what it may
   * have changed on disk.
   */
  private async attempt(action: FsGitWriteAction, fields: Readonly<Record<string, string | boolean | readonly string[]>> = {}): Promise<string | null> {
    const folder = this.folder();
    if (folder === null || this.busy()) {
      return '';
    }
    this.running.set(RUNNING[action] ?? 'Working');
    try {
      const status = await this.parent.fileSystem.gitFt.run(action, action === 'init' ? folder : (this.repository()?.root ?? folder), fields);
      this.problem.set(null);
      this.apply(action === 'init' ? status : { ...status, path: folder });
      if (TOUCHES_FILES.has(action)) {
        this.rereadFiles(status.repository?.root ?? folder);
      }
      this.parent.gitDiffFt.reloadAll();
      return null;
    } catch (error) {
      const failure = FsError.from(error);
      // Whatever it did before failing — a pull that merged half — shows.
      void this.refresh();
      return failure.message;
    } finally {
      this.running.set(null);
    }
  }

  private async fail(message: string, error: unknown): Promise<void> {
    await this.parent.modal.message({ severity: 'error', message, detail: FsError.from(error).message });
  }

  /** The listings on screen inside the repository, read again. */
  private rereadFiles(root: string): void {
    for (const path of this.parent.autoRefreshFt.foldersShown()) {
      if (GitFeature.within(root, path)) {
        void this.parent.fsDataFt.reloadListing(path);
      }
    }
  }

  /* -- building the view -------------------------------------------------------------------- */

  private item(change: FsGitChange): UiScmItem {
    const files = this.parent.fileViewModel;
    const entry = { type: change.folder ? ('directory' as const) : ('file' as const), name: nameOf(change.file) };
    const folder = parentOf(change.file);
    const kind = KIND_LABELS[change.kind];
    const where = change.area === 'staged' ? ' (staged)' : '';
    const open: UiIconAction = { id: 'open-file', label: change.folder ? 'Open Folder' : 'Open File', icon: change.folder ? 'folder-open' : 'file-text' };
    const actions: readonly UiIconAction[] =
      change.area === 'staged'
        ? [open, { id: 'unstage', label: 'Unstage Changes', icon: 'minus' }]
        : change.area === 'conflict'
          ? [open, { id: 'stage', label: 'Stage Changes (mark resolved)', icon: 'plus' }]
          : [
              open,
              { id: 'discard', label: change.area === 'untracked' ? 'Delete File' : 'Discard Changes', icon: 'arrow-back-up' },
              { id: 'stage', label: 'Stage Changes', icon: 'plus' },
            ];
    return {
      id: GitFeature.idOf(change),
      name: entry.name,
      ...(change.from !== undefined ? { description: `← ${change.from}` } : folder !== '' ? { description: folder } : {}),
      icon: files.icon(entry),
      tint: files.tint(entry),
      letter: LETTERS[change.kind],
      tone: TONES[change.kind],
      title: `${change.file} • ${kind}${where}`,
      actions,
    };
  }

  private commitRow(commit: FsGitLog['commits'][number]): UiScmCommit {
    return {
      id: commit.hash,
      subject: commit.subject,
      short: commit.short,
      detail: `${commit.author} · ${GitFeature.ago(commit.date)}`,
      title: `${commit.subject}\n${commit.hash}\n${commit.author} <${commit.email}>\n${new Date(commit.date).toLocaleString()}`,
      ...(commit.refs.length > 0 ? { refs: commit.refs.map((ref) => ref.replace(/^HEAD -> /, '')).filter((ref) => ref !== 'HEAD') } : {}),
    };
  }

  private syncOf(repository: FsGitRepository): Pick<UiScmModel, 'sync' | 'syncTitle'> {
    if (repository.upstream !== null) {
      return {
        sync: `${repository.behind}↓ ${repository.ahead}↑`,
        syncTitle: `Synchronize Changes: pull ${repository.behind} and push ${repository.ahead} commits with ${repository.upstream}`,
      };
    }
    if (repository.hasRemote && repository.branch !== null) {
      return { sync: 'Publish', syncTitle: `Publish Branch '${repository.branch}'` };
    }
    return {};
  }

  private noteOf(repository: FsGitRepository): Pick<UiScmModel, 'note' | 'noteTone'> {
    const running = this.running();
    if (running !== null) {
      return { note: `${running}…`, noteTone: 'info' };
    }
    const problem = this.problem();
    if (problem !== null) {
      return { note: problem, noteTone: 'error' };
    }
    if (repository.operation !== null) {
      const what = repository.operation === 'cherry-pick' ? 'A cherry-pick' : `A ${repository.operation}`;
      return { note: `${what} is in progress: resolve the conflicts, stage them, and commit.`, noteTone: 'info' };
    }
    if (repository.stashes > 0) {
      return { note: `${repository.stashes} ${repository.stashes === 1 ? 'stash' : 'stashes'} kept.`, noteTone: 'info' };
    }
    return {};
  }

  /* -- helpers -------------------------------------------------------------------------------- */

  /** A rename is unstaged — and staged — together with the name it came from. */
  private static filesOf(changes: readonly FsGitChange[]): string[] {
    return [...new Set(changes.flatMap((change) => (change.from === undefined ? [change.file] : [change.file, change.from])))];
  }

  private static idOf(change: FsGitChange): string {
    return `${change.area}:${change.file}`;
  }

  private static within(root: string, path: string): boolean {
    return root === '' || path === root || path.startsWith(`${root}/`);
  }

  private static titleOf(action: FsGitWriteAction): string {
    return action
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /** A branch name git would take — the backend checks again. */
  static validateBranch(value: string): string | null {
    const name = value.trim();
    if (name === '') {
      return 'Please provide a branch name';
    }
    if (
      name.startsWith('-') ||
      name.startsWith('/') ||
      name.endsWith('/') ||
      name.endsWith('.') ||
      name.endsWith('.lock') ||
      name.includes('..') ||
      name.includes('//') ||
      name.includes('@{') ||
      /[\s~^:?*[\\]/.test(name) ||
      name.split('/').some((part) => part.startsWith('.'))
    ) {
      return `'${name}' is not a valid branch name`;
    }
    return null;
  }

  /** `3 minutes ago`, `2 days ago` — the log is read at a glance. */
  static ago(iso: string, now = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    const days = seconds / 86_400;
    const [value, unit] =
      seconds < 60
        ? [seconds, 'second']
        : seconds < 3600
          ? [seconds / 60, 'minute']
          : days < 1
            ? [seconds / 3600, 'hour']
            : days < 7
              ? [days, 'day']
              : days < 30
                ? [days / 7, 'week']
                : days < 365
                  ? [days / 30, 'month']
                  : [days / 365, 'year'];
    const whole = Math.floor(value);
    return unit === 'second' && whole < 10 ? 'just now' : `${whole} ${unit}${whole === 1 ? '' : 's'} ago`;
  }

}
