import { HttpParams, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { FsGitChange, FsGitLog, FsGitRepository, FsGitStatus } from '../../file-system/file-system.model';
import { fsDirectory, fsEntry, fsEnvelope, fsListing, listUrl, settled } from '../testing/fs-fixtures';
import { WorkbenchService } from '../workbench.service';
import { GitDiffFeature } from './git-diff.feature';
import { GitFeature } from './git.feature';

/** PRD 011, §1 — git in the details sidebar: the active folder's repository, and the everyday changes. */

const gitUrl = (action: string, fields: Record<string, string> = {}): string => {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(fields)) {
    params = params.set(key, value);
  }
  const query = params.toString();
  return `/api/git/${action}${query === '' ? '' : `?${query}`}`;
};

const change = (file: string, area: FsGitChange['area'], kind: FsGitChange['kind']): FsGitChange => ({
  path: `project/${file}`,
  file,
  area,
  kind,
});

const repository = (overrides: Partial<FsGitRepository> = {}): FsGitRepository => ({
  root: 'project',
  branch: 'main',
  head: 'abc1234',
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  hasRemote: true,
  operation: null,
  stashes: 0,
  changes: [change('src/app.ts', 'staged', 'modified'), change('README.md', 'unstaged', 'modified'), change('notes.txt', 'untracked', 'untracked')],
  truncated: false,
  ...overrides,
});

const status = (path: string, repo: FsGitRepository | null = repository()): FsGitStatus => ({ path, repository: repo });

const log: FsGitLog = {
  root: 'project',
  more: false,
  commits: [
    {
      hash: 'abc1234abc1234abc1234abc1234abc1234abc12',
      short: 'abc1234',
      author: 'Ana',
      email: 'ana@example.com',
      date: new Date(Date.now() - 3 * 3600_000).toISOString(),
      subject: 'First',
      refs: ['HEAD -> main', 'origin/main'],
    },
  ],
};

describe('GitFeature', () => {
  let workbench: WorkbenchService;
  let http: HttpTestingController;
  let group: string;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    workbench = TestBed.inject(WorkbenchService);
    http = TestBed.inject(HttpTestingController);
    workbench.editorGroupsFt.start();
    http.expectOne(listUrl('')).flush(fsEnvelope(fsListing('', [fsDirectory('project'), fsDirectory('plain')])));
    group = workbench.activeGroupId();
    workbench.fileBrowserFt.navigateTo(group, 'project', 'project');
    http.expectOne(listUrl('project')).flush(fsEnvelope(fsListing('project', [fsEntry('project/README.md')])));
    await settled();
    for (const request of http.match((candidate) => !candidate.url.startsWith('/api/git'))) {
      request.flush(fsEnvelope(fsListing('', [])));
    }
  });

  afterEach(() => {
    // Listings the panel asks for on its own are not what these tests are about.
    for (const request of http.match((candidate) => candidate.url.startsWith('/api/fs/'))) {
      request.flush(fsEnvelope(fsListing('', [])));
    }
    http.verify();
    vi.restoreAllMocks();
  });

  const git = () => workbench.gitFt;

  /** Starts following the panel and answers: git is there, `project` is a repository, and its log. */
  async function started(repo: FsGitRepository | null = repository()): Promise<void> {
    git().start();
    TestBed.tick();
    http.expectOne(gitUrl('info')).flush(fsEnvelope({ available: true, version: '2.46.0', reason: null }));
    await settled();
    http.expectOne(gitUrl('status', { path: 'project' })).flush(fsEnvelope(status('project', repo)));
    await settled();
    if (repo !== null) {
      http.expectOne(gitUrl('log', { path: 'project', limit: '30', skip: '0' })).flush(fsEnvelope(log));
      await settled();
    }
  }

  function expectPost(action: string): TestRequest {
    const request = http.expectOne(gitUrl(action));
    expect(request.request.method).toBe('POST');
    return request;
  }

  it('asks nothing of git before it is started', () => {
    TestBed.tick();
    http.expectNone((request) => request.url.startsWith('/api/git'));
    expect(git().notice()).toBeNull();
    expect(git().scm()).toBeNull();
  });

  it("shows the active folder's repository: branch, sync, the changes by group and the log", async () => {
    await started();
    const scm = git().scm();
    expect(scm?.branch).toBe('main');
    expect(scm?.sync).toBe('1↓ 2↑');
    expect(scm?.groups.map((one) => [one.id, one.label, one.items.map((item) => `${item.letter} ${item.name}`)])).toEqual([
      ['staged', 'Staged Changes', ['M app.ts']],
      ['unstaged', 'Changes', ['M README.md', 'U notes.txt']],
    ]);
    expect(scm?.groups[0]?.items[0]?.description).toBe('src');
    expect(scm?.commits.map((commit) => [commit.subject, commit.refs])).toEqual([['First', ['main', 'origin/main']]]);
    expect(scm?.commits[0]?.detail).toBe('Ana · 3 hours ago');
    expect(scm?.canCommit).toBe(false); // no message yet
    expect(git().watchedFolders()).toEqual(['project/.git']);
  });

  it('follows the active panel to another folder, keeping the old status until the new one lands', async () => {
    await started();
    workbench.fileBrowserFt.navigateTo(group, 'plain', 'plain');
    for (const request of http.match(listUrl('plain'))) {
      request.flush(fsEnvelope(fsListing('plain', [])));
    }
    TestBed.tick();
    await settled();
    const request = http.expectOne(gitUrl('status', { path: 'plain' }));
    expect(git().repository()?.root).toBe('project');
    request.flush(fsEnvelope(status('plain', null)));
    await settled();
    expect(git().scm()).toBeNull();
    expect(git().notice()).toBe('This folder is not in a git repository.');
    expect(git().canInit()).toBe(true);

    void git().init();
    const init = expectPost('init');
    expect(init.request.body).toEqual({ path: 'plain' });
    init.flush(fsEnvelope(status('plain', repository({ root: 'plain', changes: [], head: null, upstream: null, hasRemote: false }))));
    await settled();
    http.expectOne(gitUrl('log', { path: 'plain', limit: '30', skip: '0' })).flush(fsEnvelope({ root: 'plain', commits: [], more: false }));
    await settled();
    expect(git().scm()?.branch).toBe('main');
    expect(git().scm()?.clean).toContain('No changes');
  });

  it('says why when there is no git, and asks for nothing more', async () => {
    git().start();
    TestBed.tick();
    http.expectOne(gitUrl('info')).flush(fsEnvelope({ available: false, version: null, reason: 'Git is not installed on this computer.' }));
    await settled();
    http.expectNone((request) => request.url.startsWith('/api/git/status'));
    expect(git().notice()).toBe('Git is not installed on this computer.');
    expect(git().canInit()).toBe(false);
    expect(workbench.commandsFt.isEnabled('git.init')).toBe(false);
  });

  it('stages and unstages one change, in the repository, and takes the new status in', async () => {
    await started();
    git().itemAction({ targetId: 'unstaged:README.md', actionId: 'stage' });
    const stage = expectPost('stage');
    expect(stage.request.body).toEqual({ files: ['README.md'], path: 'project' });
    stage.flush(fsEnvelope(status('project', repository({ changes: [change('README.md', 'staged', 'modified')] }))));
    await settled();
    expect(git().scm()?.groups.map((one) => one.id)).toEqual(['staged']);

    git().groupAction({ targetId: 'staged', actionId: 'unstage-all' });
    expect(expectPost('unstage').request.body).toEqual({ files: [], path: 'project' });
  });

  it('asks before discarding, and discards nothing when told not to', async () => {
    await started();
    const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(false);
    git().itemAction({ targetId: 'untracked:notes.txt', actionId: 'discard' });
    await settled();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: "Are you sure you want to DELETE 'notes.txt'?", confirmLabel: 'Delete File' }));
    http.expectNone(gitUrl('discard'));

    confirm.mockResolvedValue(true);
    git().groupAction({ targetId: 'unstaged', actionId: 'discard-all' });
    await settled();
    expect(expectPost('discard').request.body).toEqual({ files: ['README.md', 'notes.txt'], path: 'project' });
  });

  it('commits what is staged with the message typed, and empties the box', async () => {
    await started();
    git().setMessage('Fix it');
    expect(git().scm()?.canCommit).toBe(true);
    void git().commit();
    const commit = expectPost('commit');
    expect(commit.request.body).toEqual({ message: 'Fix it', amend: false, all: false, path: 'project' });
    commit.flush(fsEnvelope(status('project', repository({ head: 'def5678', changes: [] }))));
    await settled();
    http.expectOne(gitUrl('log', { path: 'project', limit: '30', skip: '0' })).flush(fsEnvelope(log));
    await settled();
    expect(git().scm()?.message).toBe('');
  });

  it('offers to stage everything when nothing is staged', async () => {
    await started(repository({ changes: [change('README.md', 'unstaged', 'modified')] }));
    git().setMessage('All of it');
    expect(git().scm()?.commitLabel).toBe('Commit All');
    const confirm = vi.spyOn(workbench.modal, 'confirm').mockResolvedValue(true);
    void git().commit();
    await settled();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'There are no staged changes to commit.' }));
    expect(expectPost('commit').request.body).toEqual({ message: 'All of it', amend: false, all: true, path: 'project' });
  });

  it("shows git's reason in a message window when a change fails", async () => {
    await started();
    const message = vi.spyOn(workbench.modal, 'message').mockResolvedValue();
    void git().push();
    expect(git().busy()).toBe(true);
    expect(git().scm()?.note).toBe('Pushing…');
    expectPost('push').flush({ error: { code: 'GIT_FAILED', message: 'failed to push some refs' } }, { status: 422, statusText: 'Unprocessable' });
    await settled();
    expect(message).toHaveBeenCalledWith({ severity: 'error', message: 'Git: Push failed', detail: 'failed to push some refs' });
    // What the failed push did, if anything, is read again.
    http.expectOne(gitUrl('status', { path: 'project' })).flush(fsEnvelope(status('project')));
    await settled();
    expect(git().busy()).toBe(false);
  });

  it('pulls then pushes to sync, and publishes a branch that tracks nothing', async () => {
    await started();
    void git().sync();
    expectPost('pull').flush(fsEnvelope(status('project', repository({ behind: 0, ahead: 2 }))));
    await settled();
    expectPost('push').flush(fsEnvelope(status('project', repository({ behind: 0, ahead: 0 }))));
    await settled();
    expect(git().scm()?.sync).toBe('0↓ 0↑');
  });

  it('publishes a branch that tracks nothing yet', async () => {
    await started(repository({ upstream: null, ahead: 0, behind: 0 }));
    expect(git().scm()?.sync).toBe('Publish');
    expect(workbench.commandsFt.menuItem('git.push').label).toBe('Publish Branch');
    void git().sync();
    expectPost('push').flush(fsEnvelope(status('project', repository({ ahead: 0, behind: 0 }))));
    await settled();
    expect(git().repository()?.upstream).toBe('origin/main');
  });

  it("opens a change's diff in a tab of its own, coloured line by line", async () => {
    await started();
    git().openChange('staged:src/app.ts');
    const state = workbench.editorGroupsFt.stateOf(group);
    const tab = state ? workbench.editorGroupsFt.activeTabOf(state) : undefined;
    expect(tab).toEqual(expect.objectContaining({ kind: 'diff', path: 'project/src/app.ts', label: 'app.ts (Index)', diff: { root: 'project', file: 'src/app.ts', staged: true } }));
    expect(workbench.editorGroupsFt.activeContent(group)).toBe('diff');
    http.expectOne(gitUrl('diff', { path: 'project', file: 'src/app.ts', staged: 'true' })).flush(
      fsEnvelope({
        root: 'project',
        file: 'src/app.ts',
        staged: true,
        binary: false,
        truncated: false,
        text: 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n same\n',
      }),
    );
    await settled();
    const document = workbench.gitDiffFt.browser(group)?.document;
    expect(document?.kind).toBe('diff');
    expect(document?.lines?.map((line) => line.kind)).toEqual(['meta', 'meta', 'meta', 'hunk', 'remove', 'add', 'context']);
    expect(document?.meta).toBe('+1 −1');
    expect(workbench.gitDiffFt.browser(group)?.toolbarActions.map((action) => action.id)).toEqual(['refresh', 'open-file', 'unstage']);
  });

  it('puts the Git commands in the palette while a repository is shown', async () => {
    expect(workbench.commandPaletteFt.commands.some((command) => command.category === 'Git' && command.label === 'Pull')).toBe(false);
    await started();
    const labels = workbench.commandPaletteFt.commands.filter((command) => command.category === 'Git').map((command) => command.label);
    expect(labels).toEqual(expect.arrayContaining(['Commit', 'Pull', 'Push', 'Fetch', 'Checkout to…', 'Create Branch…', 'Stash…', 'Refresh']));
    expect(labels).not.toContain('Initialize Repository');
    expect(labels).not.toContain('Pop Latest Stash');
  });

  it('reads the status again when auto-refresh sees the repository change', async () => {
    await started();
    git().noticeChanges(['elsewhere']);
    http.expectNone(gitUrl('status', { path: 'project' }));
    git().noticeChanges(['project/.git']);
    await settled();
    http.expectOne(gitUrl('status', { path: 'project' })).flush(fsEnvelope(status('project')));
    await settled();
  });
});

describe('git helpers', () => {
  it('tells a branch name git would take from one it would not', () => {
    expect(GitFeature.validateBranch('feature/login')).toBeNull();
    expect(GitFeature.validateBranch('')).toBe('Please provide a branch name');
    for (const name of ['-x', 'a..b', 'with space', 'end.lock', 'a/.hidden', 'x~1']) {
      expect(GitFeature.validateBranch(name)).not.toBeNull();
    }
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    expect(GitFeature.ago('2026-09-27T11:59:58Z', now)).toBe('just now');
    expect(GitFeature.ago('2026-09-27T11:58:00Z', now)).toBe('2 minutes ago');
    expect(GitFeature.ago('2026-09-26T12:00:00Z', now)).toBe('1 day ago');
    expect(GitFeature.ago('2025-09-27T12:00:00Z', now)).toBe('1 year ago');
  });

  it('parses a diff into lines, a new file included', () => {
    expect(GitDiffFeature.parse('')).toEqual([]);
    expect(
      GitDiffFeature.parse('diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n').map((line) => line.kind),
    ).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'add', 'add', 'meta']);
  });
});
