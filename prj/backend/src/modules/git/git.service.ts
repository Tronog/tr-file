import { lstat, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { HttpError, type Logger } from '../../core/index.js';
import type { FilePathResolver } from '../files/index.js';
import type { GitRequest } from './git-request.js';
import { GitRunner } from './git-runner.js';
import {
  GIT_LIMITS,
  type GitBranchDto,
  type GitBranchesDto,
  type GitChangeArea,
  type GitChangeDto,
  type GitChangeKind,
  type GitCommitDto,
  type GitDiffDto,
  type GitInfoDto,
  type GitLogDto,
  type GitOperationInProgress,
  type GitRepositoryDto,
  type GitStatusDto,
} from './git.model.js';

/** How long "git is not installed" is believed before it is looked for again. */
const MISSING_RECHECK_MS = 30_000;

/** A repository found for a request: where it is, on the host and in the root. */
interface Repository {
  /** Root-relative path of its top folder. */
  readonly root: string;
  /** The same folder on the host. */
  readonly absolute: string;
}

export interface GitServiceOptions {
  /**
   * Whether git may be used at all. Git runs the repository's own hooks and
   * reads its own configuration, which may name programs to run — on the
   * user's own computer that is what they asked for; on a server it is code
   * anyone who can write files there gets run, so a server has to say yes.
   */
  readonly enabled: boolean;
  /** Stands in for the `git` program in tests. */
  readonly runner?: GitRunner;
}

/** A pathspec git takes as the very name given — no globs, no magic. */
const literal = (file: string): string => `:(literal)${file}`;

const joinRoot = (root: string, file: string): string => (root === '' ? file : `${root}/${file}`);

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Git for the folders of the root (PRD 011, §1): the status of the repository
 * a folder is in, its log, branches and diffs, and the everyday changes —
 * stage, unstage, discard, commit, switch and make branches, fetch, pull,
 * push, stash — each one `git` run in that repository's folder.
 *
 * A folder is in a repository when it, or a folder above it inside the root,
 * holds a `.git` — a folder, or the file a worktree or submodule has in its
 * place. The walk up stops at the root: a repository around the root is not
 * the root's business. Nothing here reads or writes a file itself; git does,
 * and the resolver has already said the repository is inside the root.
 *
 * Changes to one repository run one at a time, so two clicks never race for
 * its index lock; reads run beside them without taking it.
 */
export class GitService {
  private readonly runner: GitRunner;
  private readonly enabled: boolean;
  private known: { readonly info: GitInfoDto; readonly at: number } | null = null;
  /** The last change started in each repository, by host path: the next waits for it. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
    options: GitServiceOptions,
  ) {
    this.enabled = options.enabled;
    this.runner = options.runner ?? new GitRunner(logger);
  }

  /** Whether git can be used here; looked up once, and again a while after it was missing. */
  async info(): Promise<GitInfoDto> {
    if (!this.enabled) {
      return { available: false, version: null, reason: 'Git is switched off on this server (GIT_ENABLED).' };
    }
    const cached = this.known;
    if (cached !== null && (cached.info.available || Date.now() - cached.at < MISSING_RECHECK_MS)) {
      return cached.info;
    }
    const version = await this.runner.version();
    const info: GitInfoDto =
      version === null
        ? { available: false, version: null, reason: 'Git is not installed on this computer.' }
        : { available: true, version, reason: null };
    this.known = { info, at: Date.now() };
    return info;
  }

  /** Runs one validated request; what the routes and the bridge both call. */
  async handle(request: GitRequest): Promise<unknown> {
    if (request.action === 'info') {
      return this.info();
    }
    await this.assertAvailable();
    switch (request.action) {
      case 'status':
        return this.status(request.path);
      case 'log':
        return this.log(await this.repositoryOf(request.path), request.limit, request.skip);
      case 'branches':
        return this.branches(await this.repositoryOf(request.path));
      case 'diff':
        return this.diff(await this.repositoryOf(request.path), request.file, request.staged);
      case 'init':
        return this.init(request.path);
      default:
        return this.change(request);
    }
  }

  /* -- reading ---------------------------------------------------------------- */

  /** The repository `path` is in, as it stands — or `repository: null` when it is in none. */
  async status(path: string): Promise<GitStatusDto> {
    const folder = await this.folder(path);
    const repository = await this.find(folder.relative);
    return { path: folder.relative, repository: repository === null ? null : await this.describe(repository) };
  }

  private async describe(repository: Repository): Promise<GitRepositoryDto> {
    const [status, remotes, operation] = await Promise.all([
      this.git(repository, ['status', '--porcelain=v2', '--branch', '--show-stash', '-z', '--untracked-files=normal'], { read: true }),
      this.git(repository, ['remote'], { read: true }),
      this.operationIn(repository),
    ]);
    return {
      root: repository.root,
      ...GitService.parseStatus(status.stdout.toString('utf8'), repository.root),
      hasRemote: remotes.stdout.toString('utf8').trim() !== '',
      operation,
    };
  }

  private async log(repository: Repository, limit: number, skip: number): Promise<GitLogDto> {
    if (!(await this.hasHead(repository))) {
      return { root: repository.root, commits: [], more: false };
    }
    const output = await this.git(repository, [
      'log',
      `--max-count=${limit + 1}`,
      `--skip=${skip}`,
      '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e',
    ]);
    const commits = output.stdout
      .toString('utf8')
      .split('\x1e')
      .map((record) => record.replace(/^\n/, ''))
      .filter((record) => record !== '')
      .map((record): GitCommitDto => {
        const [hash = '', short = '', author = '', email = '', date = '', subject = '', refs = ''] = record.split('\x1f');
        return { hash, short, author, email, date, subject, refs: refs.split(', ').filter((ref) => ref !== '') };
      });
    return { root: repository.root, commits: commits.slice(0, limit), more: commits.length > limit };
  }

  private async branches(repository: Repository): Promise<GitBranchesDto> {
    const output = await this.git(
      repository,
      ['for-each-ref', '--format=%(refname)%1f%(objectname:short)%1f%(upstream:short)%1f%(HEAD)', 'refs/heads', 'refs/remotes'],
      { read: true },
    );
    const branches = output.stdout
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== '')
      .flatMap((line): GitBranchDto[] => {
        const [ref = '', commit = '', upstream = '', head = ''] = line.split('\x1f');
        const remote = ref.startsWith('refs/remotes/');
        const name = ref.replace(/^refs\/(heads|remotes)\//, '');
        // `origin/HEAD` is which branch the remote calls its own — not one to switch to.
        if (remote && name.endsWith('/HEAD')) {
          return [];
        }
        return [{ name, remote, current: head === '*', commit, upstream: upstream === '' ? null : upstream }];
      });
    return { root: repository.root, branches };
  }

  private async diff(repository: Repository, file: string, staged: boolean): Promise<GitDiffDto> {
    const common = ['--no-color', '--no-ext-diff', '--no-textconv', '-M'];
    let output;
    if (!staged && !(await this.isTracked(repository, file))) {
      // A new file git does not know yet: all of it is the change.
      output = await this.git(repository, ['diff', ...common, '--no-index', '--', '/dev/null', file], {
        accept: [1],
        maxBytes: GIT_LIMITS.maxDiffBytes,
      });
    } else {
      output = await this.git(repository, ['diff', ...common, ...(staged ? ['--cached'] : []), '--', literal(file)], {
        read: true,
        maxBytes: GIT_LIMITS.maxDiffBytes,
      });
    }
    const text = output.stdout.toString('utf8');
    return {
      root: repository.root,
      file,
      staged,
      text,
      binary: !text.includes('\n@@') && /^Binary files .* differ$/m.test(text),
      truncated: output.truncated,
    };
  }

  /* -- changing ---------------------------------------------------------------- */

  /** Makes the folder a repository of its own, and answers with its status. */
  private async init(path: string): Promise<GitStatusDto> {
    const folder = await this.folder(path);
    if (folder.absolute === '') {
      throw HttpError.badRequest('Choose a folder to make a repository of');
    }
    await this.runner.run(folder.absolute, ['init', '-q'], { timeoutMs: GIT_LIMITS.localTimeoutMs });
    this.logger.info('repository created', { path: folder.relative });
    return this.status(folder.relative);
  }

  /** Every change to an existing repository: one at a time per repository, then its new status. */
  private async change(request: Exclude<GitRequest, { action: 'info' | 'status' | 'log' | 'branches' | 'diff' | 'init' }>): Promise<GitStatusDto> {
    const folder = await this.folder(request.path);
    const repository = await this.repositoryOf(folder.relative);
    await this.serialised(repository, () => this.apply(repository, request));
    this.logger.info('git', { action: request.action, repository: repository.root });
    return { path: folder.relative, repository: await this.describe(repository) };
  }

  private async apply(repository: Repository, request: Parameters<GitService['change']>[0]): Promise<void> {
    const long = { timeoutMs: GIT_LIMITS.longTimeoutMs };
    switch (request.action) {
      case 'stage':
        await this.git(repository, ['add', '-A', ...(request.files.length === 0 ? [] : ['--', ...request.files.map(literal)])]);
        return;
      case 'unstage':
        await this.unstage(repository, request.files);
        return;
      case 'discard':
        await this.discard(repository, request.files);
        return;
      case 'commit': {
        if (request.all) {
          await this.git(repository, ['add', '-A']);
        }
        const empty = request.message.trim() === '';
        // Hooks run — a pre-commit that lints takes its time.
        await this.git(
          repository,
          ['commit', '-q', ...(request.amend ? ['--amend'] : []), ...(empty ? ['--no-edit'] : ['-F', '-'])],
          { ...long, ...(empty ? {} : { input: request.message }) },
        );
        return;
      }
      case 'checkout':
        await this.checkout(repository, request.branch);
        return;
      case 'branch-create':
        await this.git(repository, request.checkout ? ['checkout', '-q', '-b', request.name] : ['branch', request.name]);
        return;
      case 'branch-delete':
        await this.git(repository, ['branch', request.force ? '-D' : '-d', request.name]);
        return;
      case 'fetch':
        await this.git(repository, ['fetch', '--all', '--prune', '-q'], long);
        return;
      case 'pull':
        await this.git(repository, ['pull', '--no-edit', '-q'], long);
        return;
      case 'push':
        await this.push(repository);
        return;
      case 'stash':
        await this.git(repository, ['stash', 'push', '--include-untracked', '-q', ...(request.message === '' ? [] : ['-m', request.message])]);
        return;
      case 'stash-pop':
        await this.git(repository, ['stash', 'pop', '-q']);
        return;
    }
  }

  /** Out of the index, back to what HEAD has — or, before the first commit, out of it altogether. */
  private async unstage(repository: Repository, files: readonly string[]): Promise<void> {
    const specs = files.map(literal);
    if (await this.hasHead(repository)) {
      await this.git(repository, ['reset', '-q', ...(specs.length === 0 ? [] : ['--', ...specs])]);
      return;
    }
    await this.git(repository, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...(specs.length === 0 ? ['.'] : specs)]);
  }

  /**
   * Throws a change away: a file git knows goes back to what the index has;
   * one it does not know is deleted — as VS Code does, and after asking.
   */
  private async discard(repository: Repository, files: readonly string[]): Promise<void> {
    const listed = await this.git(repository, ['ls-files', '-z', '--', ...files.map(literal)], { read: true });
    const known = listed.stdout.toString('utf8').split('\0').filter((file) => file !== '');
    const tracked = files.filter((file) => known.some((candidate) => candidate === file || candidate.startsWith(`${file}/`)));
    const untracked = files.filter((file) => !tracked.includes(file));
    if (tracked.length > 0) {
      await this.git(repository, ['checkout', '-q', '--', ...tracked.map(literal)]);
    }
    if (untracked.length > 0) {
      await this.git(repository, ['clean', '-f', '-d', '-q', '--', ...untracked.map(literal)]);
    }
  }

  /**
   * Switches branch. A remote one, `origin/fix`, is checked out as the local
   * branch that tracks it — made first when there is none yet.
   */
  private async checkout(repository: Repository, branch: string): Promise<void> {
    if (await this.refExists(repository, `refs/heads/${branch}`)) {
      await this.git(repository, ['checkout', '-q', branch, '--']);
      return;
    }
    if (await this.refExists(repository, `refs/remotes/${branch}`)) {
      const local = branch.slice(branch.indexOf('/') + 1);
      if (await this.refExists(repository, `refs/heads/${local}`)) {
        await this.git(repository, ['checkout', '-q', local, '--']);
      } else {
        await this.git(repository, ['checkout', '-q', '-b', local, '--track', `refs/remotes/${branch}`]);
      }
      return;
    }
    throw HttpError.notFound(`There is no branch '${branch}'`);
  }

  /** Pushes; a branch that tracks nothing yet is published to `origin` (or the only remote) and tracks it from then on. */
  private async push(repository: Repository): Promise<void> {
    const long = { timeoutMs: GIT_LIMITS.longTimeoutMs };
    const upstream = await this.git(repository, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { accept: [128], read: true });
    if (upstream.code === 0) {
      await this.git(repository, ['push', '-q'], long);
      return;
    }
    const branch = (await this.git(repository, ['symbolic-ref', '-q', '--short', 'HEAD'], { accept: [1], read: true })).stdout.toString('utf8').trim();
    if (branch === '') {
      throw HttpError.conflict('HEAD is not on a branch; check one out before pushing');
    }
    const remotes = (await this.git(repository, ['remote'], { read: true })).stdout.toString('utf8').split('\n').filter((name) => name !== '');
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    if (remote === undefined) {
      throw HttpError.conflict('This repository has no remote to push to');
    }
    await this.git(repository, ['push', '-q', '-u', remote, `HEAD:refs/heads/${branch}`], long);
  }

  /* -- finding the repository ---------------------------------------------------- */

  private async assertAvailable(): Promise<void> {
    const info = await this.info();
    if (!info.available) {
      throw new HttpError(503, 'GIT_UNAVAILABLE', info.reason ?? 'Git is not available');
    }
  }

  /** A folder of the root, proven to be one. */
  private async folder(path: string): Promise<{ readonly relative: string; readonly absolute: string }> {
    const resolved = await this.resolver.resolveReal(path);
    if (resolved.absolute === '') {
      return resolved; // The list of drives: no folder, in no repository.
    }
    let stats;
    try {
      stats = await stat(resolved.absolute);
    } catch {
      throw HttpError.notFound(`No such folder: ${resolved.relative}`);
    }
    if (!stats.isDirectory()) {
      throw HttpError.badRequest(`Not a folder: ${resolved.relative}`);
    }
    return resolved;
  }

  /** The repository a folder is in; `NOT_A_REPOSITORY` when it is in none. */
  private async repositoryOf(path: string): Promise<Repository> {
    const repository = await this.find((await this.folder(path)).relative);
    if (repository === null) {
      throw new HttpError(409, 'NOT_A_REPOSITORY', 'This folder is not in a git repository');
    }
    return repository;
  }

  /** Walks up from `relative` to the first folder holding a `.git`, stopping at the root. */
  private async find(relative: string): Promise<Repository | null> {
    let current = relative;
    for (;;) {
      const resolved = await this.resolver.resolveReal(current);
      if (resolved.absolute !== '') {
        try {
          const marker = await lstat(join(resolved.absolute, '.git'));
          if (marker.isDirectory() || marker.isFile()) {
            return { root: resolved.relative, absolute: resolved.absolute };
          }
        } catch {
          // No `.git` here; look further up.
        }
      }
      if (this.resolver.isRoot(current)) {
        return null;
      }
      current = parentOf(current);
    }
  }

  /** What the repository is in the middle of: git leaves a file in its own folder for each. */
  private async operationIn(repository: Repository): Promise<GitOperationInProgress> {
    const gitDir = await GitService.gitDirOf(repository.absolute);
    const exists = (name: string): Promise<boolean> => lstat(join(gitDir, name)).then(() => true, () => false);
    const [rebaseMerge, rebaseApply, merge, cherryPick, revert] = await Promise.all(
      ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].map(exists),
    );
    return rebaseMerge || rebaseApply ? 'rebase' : merge ? 'merge' : cherryPick ? 'cherry-pick' : revert ? 'revert' : null;
  }

  /** `.git` itself, or where the `gitdir:` line of a `.git` file points. */
  private static async gitDirOf(top: string): Promise<string> {
    const marker = join(top, '.git');
    try {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(marker, 'utf8'))?.[1]?.trim();
      if (pointer !== undefined) {
        return isAbsolute(pointer) ? pointer : resolve(top, pointer);
      }
    } catch {
      // A folder: `readFile` fails, and `.git` is the answer.
    }
    return marker;
  }

  /* -- running git ----------------------------------------------------------------- */

  private git(
    repository: Repository,
    args: readonly string[],
    options: { timeoutMs?: number; input?: string; accept?: readonly number[]; maxBytes?: number; read?: boolean } = {},
  ) {
    return this.runner.run(repository.absolute, args, { timeoutMs: GIT_LIMITS.localTimeoutMs, ...options });
  }

  private async hasHead(repository: Repository): Promise<boolean> {
    return (await this.git(repository, ['rev-parse', '-q', '--verify', 'HEAD'], { accept: [1, 128], read: true })).code === 0;
  }

  private async refExists(repository: Repository, ref: string): Promise<boolean> {
    return (await this.git(repository, ['show-ref', '--verify', '--quiet', ref], { accept: [1, 128], read: true })).code === 0;
  }

  private async isTracked(repository: Repository, file: string): Promise<boolean> {
    return (await this.git(repository, ['ls-files', '--error-unmatch', '--', literal(file)], { accept: [1], read: true })).code === 0;
  }

  /** Runs `work` once every change already started in the repository has finished. */
  private serialised<T>(repository: Repository, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(repository.absolute) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch(() => undefined);
    this.queues.set(repository.absolute, settled);
    void settled.then(() => {
      if (this.queues.get(repository.absolute) === settled) {
        this.queues.delete(repository.absolute);
      }
    });
    return next;
  }

  /* -- parsing ----------------------------------------------------------------------- */

  /**
   * `git status --porcelain=v2 --branch --show-stash -z`: the branch headers,
   * then one record per path — `1` changed, `2` renamed or copied (its source
   * in the next field), `u` unmerged, `?` untracked. A path with changes both
   * staged and not is two changes, one per area.
   */
  static parseStatus(
    output: string,
    root: string,
  ): Pick<GitRepositoryDto, 'branch' | 'head' | 'upstream' | 'ahead' | 'behind' | 'stashes' | 'changes' | 'truncated'> {
    const fields = output.split('\0');
    let branch: string | null = null;
    let head: string | null = null;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    let stashes = 0;
    const changes: GitChangeDto[] = [];
    let truncated = false;

    const add = (file: string, area: GitChangeArea, kind: GitChangeKind, from?: string): void => {
      if (changes.length >= GIT_LIMITS.maxChanges) {
        truncated = true;
        return;
      }
      // An untracked folder is listed once, as `name/`, rather than file by file.
      const folder = file.endsWith('/');
      const name = folder ? file.slice(0, -1) : file;
      changes.push({
        path: joinRoot(root, name),
        file: name,
        area,
        kind,
        ...(from === undefined ? {} : { from }),
        ...(folder ? { folder: true } : {}),
      });
    };

    for (let index = 0; index < fields.length; index++) {
      const record = fields[index] as string;
      if (record === '') {
        continue;
      }
      if (record.startsWith('# ')) {
        const [key = '', ...rest] = record.slice(2).split(' ');
        const value = rest.join(' ');
        if (key === 'branch.oid') {
          head = value === '(initial)' ? null : value.slice(0, 7);
        } else if (key === 'branch.head') {
          branch = value === '(detached)' ? null : value;
        } else if (key === 'branch.upstream') {
          upstream = value;
        } else if (key === 'branch.ab') {
          const match = /^\+(\d+) -(\d+)$/.exec(value);
          ahead = Number(match?.[1] ?? 0);
          behind = Number(match?.[2] ?? 0);
        } else if (key === 'stash') {
          stashes = Number(value) || 0;
        }
        continue;
      }
      const type = record[0];
      if (type === '?') {
        add(record.slice(2), 'untracked', 'untracked');
      } else if (type === 'u') {
        // u XY sub m1 m2 m3 mW h1 h2 h3 path
        add(record.split(' ').slice(10).join(' '), 'conflict', 'conflict');
      } else if (type === '1' || type === '2') {
        // 1 XY sub mH mI mW hH hI path  ·  2 XY sub mH mI mW hH hI Xscore path, then its source
        const parts = record.split(' ');
        const xy = parts[1] ?? '..';
        const file = parts.slice(type === '1' ? 8 : 9).join(' ');
        const from = type === '2' ? fields[++index] : undefined;
        const staged = GitService.kindOf(xy[0]);
        const unstaged = GitService.kindOf(xy[1]);
        if (staged !== null) {
          add(file, 'staged', staged, staged === 'renamed' || staged === 'copied' ? from : undefined);
        }
        if (unstaged !== null) {
          add(file, 'unstaged', unstaged);
        }
      }
    }
    return { branch, head, upstream, ahead, behind, stashes, changes, truncated };
  }

  private static kindOf(letter: string | undefined): GitChangeKind | null {
    switch (letter) {
      case 'M':
        return 'modified';
      case 'A':
        return 'added';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      case 'C':
        return 'copied';
      case 'T':
        return 'type-changed';
      default:
        return null;
    }
  }
}
