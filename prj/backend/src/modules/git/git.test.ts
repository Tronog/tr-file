import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { App } from '../../app.js';
import { AppConfig } from '../../config/index.js';
import { Logger } from '../../core/index.js';
import { GitRunner } from './git-runner.js';
import { GitService } from './git.service.js';
import type { GitBranchesDto, GitDiffDto, GitInfoDto, GitLogDto, GitStatusDto } from './git.model.js';

/** PRD 011, §1 — git over HTTP and the bridge, against real repositories. */

const hasGit = (await new GitRunner(Logger.create('error')).version()) !== null;

let scratch: string;
let root: string;
let server: Server;
let base: string;
let app: App;

async function get<T>(action: string, query: Record<string, string>): Promise<{ status: number; data: T; code?: string }> {
  const response = await fetch(`${base}/git/${action}?${new URLSearchParams(query).toString()}`);
  const body = (await response.json()) as { data: T; error?: { code: string } };
  return { status: response.status, data: body.data, ...(body.error ? { code: body.error.code } : {}) };
}

async function post<T = GitStatusDto>(action: string, body: unknown): Promise<{ status: number; data: T; message?: string; code?: string }> {
  const response = await fetch(`${base}/git/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-TR-File-Request': '1' },
  });
  const parsed = (await response.json()) as { data: T; error?: { code: string; message: string } };
  return { status: response.status, data: parsed.data, ...(parsed.error ? { code: parsed.error.code, message: parsed.error.message } : {}) };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tr-file-git-'));
  // A configuration of the tests' own: who commits, what the first branch is, no signing, no hooks.
  const config = join(scratch, 'gitconfig');
  await writeFile(
    config,
    '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[pull]\n\trebase = false\n',
  );
  process.env['GIT_CONFIG_GLOBAL'] = config;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';

  // The files root sits inside a repository of its own, which must never be found.
  git(scratch, 'init', '-q');
  root = join(scratch, 'files');
  await mkdir(join(root, 'project', 'src'), { recursive: true });
  await writeFile(join(root, 'project', 'README.md'), '# hi\n');
  await writeFile(join(root, 'project', 'src', 'main.ts'), 'export {};\n');
  await mkdir(join(root, 'plain'));

  app = new App(AppConfig.fromEnv({ FILES_ROOT: root, NODE_ENV: 'test' }), Logger.create('error'), '0.0.0-test');
  server = app.instance.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  app.close();
  await rm(scratch, { recursive: true, force: true });
});

describe('git', { skip: hasGit ? false : 'git is not installed' }, () => {
  it('says git is there', async () => {
    const { data } = await get<GitInfoDto>('info', {});
    assert.equal(data.available, true);
    assert.match(data.version ?? '', /^\d+\.\d+/);
  });

  it('finds no repository above the files root', async () => {
    const { status, data } = await get<GitStatusDto>('status', { path: 'plain' });
    assert.equal(status, 200);
    assert.equal(data.repository, null);
    assert.equal((await get<GitStatusDto>('status', { path: '' })).data.repository, null);
    assert.equal((await post('stage', { path: 'plain', files: [] })).code, 'NOT_A_REPOSITORY');
  });

  it('makes a repository, lists what is new, stages and commits it', async () => {
    const created = await post('init', { path: 'project' });
    assert.equal(created.status, 200);
    assert.equal(created.data.repository?.root, 'project');
    assert.equal(created.data.repository?.branch, 'main');
    assert.equal(created.data.repository?.head, null);
    const untracked = created.data.repository?.changes ?? [];
    assert.deepEqual(
      untracked.map((change) => [change.file, change.area, change.folder ?? false]).sort(),
      [
        ['README.md', 'untracked', false],
        ['src', 'untracked', true],
      ],
    );
    assert.equal(untracked.find((change) => change.file === 'src')?.path, 'project/src');

    // A folder inside it finds the same repository.
    assert.equal((await get<GitStatusDto>('status', { path: 'project/src' })).data.repository?.root, 'project');

    const staged = await post('stage', { path: 'project/src', files: [] });
    assert.deepEqual(
      staged.data.repository?.changes.map((change) => [change.path, change.area, change.kind]).sort(),
      [
        ['project/README.md', 'staged', 'added'],
        ['project/src/main.ts', 'staged', 'added'],
      ],
    );
    // Before the first commit, unstaging takes a file out of the index altogether.
    const unstaged = await post('unstage', { path: 'project', files: ['README.md'] });
    assert.equal(unstaged.data.repository?.changes.find((change) => change.file === 'README.md')?.area, 'untracked');

    const committed = await post('commit', { path: 'project', message: 'First', all: true });
    assert.equal(committed.status, 200, committed.message);
    assert.deepEqual(committed.data.repository?.changes, []);
    assert.match(committed.data.repository?.head ?? '', /^[0-9a-f]{7}$/);

    const log = await get<GitLogDto>('log', { path: 'project' });
    assert.deepEqual(log.data.commits.map((commit) => commit.subject), ['First']);
    assert.equal(log.data.commits[0]?.author, 'Test');
    assert.ok(log.data.commits[0]?.refs.includes('HEAD -> main'));
    assert.equal(log.data.more, false);
  });

  it('shows, stages, unstages and discards a change', async () => {
    await writeFile(join(root, 'project', 'README.md'), '# hi\nmore\n');
    const status = await get<GitStatusDto>('status', { path: 'project' });
    assert.deepEqual(status.data.repository?.changes.map((change) => [change.file, change.area, change.kind]), [['README.md', 'unstaged', 'modified']]);

    const diff = await get<GitDiffDto>('diff', { path: 'project', file: 'README.md' });
    assert.match(diff.data.text, /^\+more$/m);
    assert.equal(diff.data.binary, false);
    assert.equal(diff.data.staged, false);

    const staged = await post('stage', { path: 'project', files: ['README.md'] });
    assert.equal(staged.data.repository?.changes[0]?.area, 'staged');
    assert.match((await get<GitDiffDto>('diff', { path: 'project', file: 'README.md', staged: 'true' })).data.text, /^\+more$/m);
    assert.equal((await get<GitDiffDto>('diff', { path: 'project', file: 'README.md' })).data.text, '');

    await post('unstage', { path: 'project', files: ['README.md'] });
    const discarded = await post('discard', { path: 'project', files: ['README.md'] });
    assert.deepEqual(discarded.data.repository?.changes, []);
    assert.equal(await readFile(join(root, 'project', 'README.md'), 'utf8'), '# hi\n');
  });

  it('shows a new file whole, and deletes it when its change is discarded', async () => {
    await writeFile(join(root, 'project', 'notes.txt'), 'one\ntwo\n');
    const diff = await get<GitDiffDto>('diff', { path: 'project', file: 'notes.txt' });
    assert.match(diff.data.text, /^\+one$/m);
    await post('discard', { path: 'project', files: ['notes.txt'] });
    await assert.rejects(stat(join(root, 'project', 'notes.txt')));
  });

  it('makes, switches and deletes branches', async () => {
    const created = await post('branch-create', { path: 'project', name: 'feature/x' });
    assert.equal(created.data.repository?.branch, 'feature/x');
    const branches = await get<GitBranchesDto>('branches', { path: 'project' });
    assert.deepEqual(
      branches.data.branches.map((branch) => [branch.name, branch.current]).sort(),
      [
        ['feature/x', true],
        ['main', false],
      ],
    );
    assert.equal((await post('checkout', { path: 'project', branch: 'main' })).data.repository?.branch, 'main');
    await post('branch-delete', { path: 'project', name: 'feature/x' });
    assert.deepEqual((await get<GitBranchesDto>('branches', { path: 'project' })).data.branches.map((branch) => branch.name), ['main']);
    assert.equal((await post('checkout', { path: 'project', branch: 'nope' })).code, 'NOT_FOUND');
  });

  it('stashes and brings back', async () => {
    await writeFile(join(root, 'project', 'README.md'), '# stashed\n');
    const stashed = await post('stash', { path: 'project', message: 'wip' });
    assert.equal(stashed.data.repository?.stashes, 1);
    assert.deepEqual(stashed.data.repository?.changes, []);
    const popped = await post('stash-pop', { path: 'project' });
    assert.equal(popped.data.repository?.stashes, 0);
    assert.equal(await readFile(join(root, 'project', 'README.md'), 'utf8'), '# stashed\n');
    await post('discard', { path: 'project', files: ['README.md'] });
  });

  it('publishes a branch, then pulls and fetches', async () => {
    const remote = join(scratch, 'remote.git');
    git(scratch, 'init', '-q', '--bare', remote);
    git(join(root, 'project'), 'remote', 'add', 'origin', remote);
    assert.equal((await get<GitStatusDto>('status', { path: 'project' })).data.repository?.hasRemote, true);

    const pushed = await post('push', { path: 'project' });
    assert.equal(pushed.status, 200, pushed.message);
    assert.equal(pushed.data.repository?.upstream, 'origin/main');
    assert.equal(pushed.data.repository?.ahead, 0);

    // Someone else pushes a commit.
    const other = join(scratch, 'other');
    git(scratch, 'clone', '-q', remote, other);
    await writeFile(join(other, 'theirs.txt'), 'theirs\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'Theirs');
    git(other, 'push', '-q');

    await post('fetch', { path: 'project' });
    assert.equal((await get<GitStatusDto>('status', { path: 'project' })).data.repository?.behind, 1);
    const pulled = await post('pull', { path: 'project' });
    assert.equal(pulled.status, 200, pulled.message);
    assert.equal(pulled.data.repository?.behind, 0);
    assert.equal(await readFile(join(root, 'project', 'theirs.txt'), 'utf8'), 'theirs\n');
    assert.ok((await get<GitBranchesDto>('branches', { path: 'project' })).data.branches.some((branch) => branch.name === 'origin/main' && branch.remote));
  });

  it("answers git's own reason when it refuses", async () => {
    const failed = await post('push', { path: 'plain' });
    assert.equal(failed.code, 'NOT_A_REPOSITORY');
    const nothing = await post('commit', { path: 'project', message: 'Nothing to commit' });
    assert.equal(nothing.status, 422);
    assert.equal(nothing.code, 'GIT_FAILED');
  });

  it('refuses what is not a file of the repository, or not a branch name', async () => {
    assert.equal((await post('stage', { path: 'project', files: ['../plain'] })).status, 400);
    assert.equal((await post('stage', { path: 'project', files: ['/etc/passwd'] })).status, 400);
    assert.equal((await post('branch-create', { path: 'project', name: '--force' })).status, 400);
    assert.equal((await post('branch-create', { path: 'project', name: 'a..b' })).status, 400);
    assert.equal((await post('commit', { path: 'project', message: '  ' })).status, 400);
    assert.equal((await post('discard', { path: 'project', files: [] })).status, 400);
    assert.equal((await get('status', { path: '../' })).status, 403);
    assert.equal((await get('status', { path: 'project/README.md' })).status, 400);
    const missing = await fetch(`${base}/git/unknown`);
    assert.equal(missing.status, 404);
  });

  it('answers the same over the bridge', async () => {
    const status = await app.bridge.dispatch({ command: 'git', action: 'status', path: 'project' });
    assert.ok('data' in status);
    assert.equal((status.data as GitStatusDto).repository?.root, 'project');
    const refused = await app.bridge.dispatch({ command: 'git', action: 'rm-rf', path: 'project' });
    assert.ok('error' in refused);
    assert.equal(refused.error.code, 'BAD_REQUEST');
  });

  it('is off on a server that has not switched it on', async () => {
    const service = new GitService(
      // Never reached: switched off, nothing is resolved.
      undefined as never,
      Logger.create('error'),
      { enabled: false },
    );
    assert.equal((await service.info()).available, false);
    await assert.rejects(service.handle({ action: 'status', path: '' }), (error: { code?: string }) => error.code === 'GIT_UNAVAILABLE');
    assert.equal(AppConfig.fromEnv({ NODE_ENV: 'production', AUTH_ENABLED: 'false' }).gitEnabled, false);
    assert.equal(AppConfig.fromEnv({ NODE_ENV: 'production', AUTH_ENABLED: 'false', GIT_ENABLED: 'true' }).gitEnabled, true);
    assert.equal(AppConfig.fromEnv({}).gitEnabled, true);
  });
});

describe('git status parsing', () => {
  it('reads renames, conflicts, both areas of one file, and the branch', () => {
    const output = [
      '# branch.oid 0123456789abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '# stash 3',
      '1 MM N... 100644 100644 100644 aaa bbb both.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc clash.txt',
      '? new dir/',
      '',
    ].join('\0');
    const parsed = GitService.parseStatus(output, 'repo');
    assert.equal(parsed.branch, 'main');
    assert.equal(parsed.head, '0123456');
    assert.equal(parsed.upstream, 'origin/main');
    assert.equal(parsed.ahead, 2);
    assert.equal(parsed.behind, 1);
    assert.equal(parsed.stashes, 3);
    assert.deepEqual(parsed.changes, [
      { path: 'repo/both.txt', file: 'both.txt', area: 'staged', kind: 'modified' },
      { path: 'repo/both.txt', file: 'both.txt', area: 'unstaged', kind: 'modified' },
      { path: 'repo/new name.txt', file: 'new name.txt', area: 'staged', kind: 'renamed', from: 'old name.txt' },
      { path: 'repo/clash.txt', file: 'clash.txt', area: 'conflict', kind: 'conflict' },
      { path: 'repo/new dir', file: 'new dir', area: 'untracked', kind: 'untracked', folder: true },
    ]);
  });

  it('reads a detached HEAD before and after the first commit', () => {
    assert.equal(GitService.parseStatus('# branch.oid (initial)\0# branch.head main\0', '').head, null);
    const detached = GitService.parseStatus('# branch.oid abcdef0123\0# branch.head (detached)\0', '');
    assert.equal(detached.branch, null);
    assert.equal(detached.upstream, null);
  });

  it("keeps git's reason, not its hints", () => {
    assert.equal(
      GitRunner.explain('hint: Updates were rejected\nerror: failed to push some refs\nhint: try pull\n', Buffer.alloc(0), 'push'),
      'failed to push some refs',
    );
    assert.equal(GitRunner.explain('', Buffer.from('nothing to commit, working tree clean\n'), 'commit'), 'nothing to commit, working tree clean');
  });
});
