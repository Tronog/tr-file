/**
 * Git (PRD 011, §1): what `/api/git` answers.
 *
 * Every path is root-relative, as everywhere else in the API — `root` of a
 * repository and `path` of a change can be opened like any listing entry —
 * while `file` is the same change relative to the repository's top folder,
 * which is what git itself names it and what a request sends back.
 */

/** Whether this server can offer git at all, and why not when it cannot. */
export interface GitInfoDto {
  /** `git` was found and may be used. */
  readonly available: boolean;
  /** `git version 2.46.0`'s number, when it was found. */
  readonly version: string | null;
  /** Why git is not offered: not installed, or switched off on this server. */
  readonly reason: string | null;
}

/** Which of git's areas a change is in — VS Code's groups. */
export type GitChangeArea = 'staged' | 'unstaged' | 'untracked' | 'conflict';

/** What happened to a file, in words rather than git's letters. */
export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked' | 'conflict';

/** One changed file in one area. A file staged *and* changed again is two changes. */
export interface GitChangeDto {
  /** Root-relative, for opening it. */
  readonly path: string;
  /** Relative to the repository's top folder, as git names it and requests send it. */
  readonly file: string;
  /** A rename's or copy's source, relative to the repository. */
  readonly from?: string;
  readonly area: GitChangeArea;
  readonly kind: GitChangeKind;
  /** An untracked folder, listed whole: nothing in it is known to git yet. */
  readonly folder?: boolean;
}

/** What a repository is in the middle of, when it is not simply on a branch. */
export type GitOperationInProgress = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;

/** A repository as it stands. */
export interface GitRepositoryDto {
  /** Root-relative path of the folder holding `.git`. */
  readonly root: string;
  /** The branch checked out; `null` when HEAD is detached. */
  readonly branch: string | null;
  /** Short hash of HEAD; `null` before the first commit. */
  readonly head: string | null;
  /** The branch it tracks, `origin/main`; `null` when it tracks none. */
  readonly upstream: string | null;
  /** Commits here the upstream has not got, and the other way round. */
  readonly ahead: number;
  readonly behind: number;
  /** Whether it has any remote to fetch from or push to. */
  readonly hasRemote: boolean;
  readonly operation: GitOperationInProgress;
  /** How many stashes are kept. */
  readonly stashes: number;
  readonly changes: readonly GitChangeDto[];
  /** More changes than `GIT_LIMITS.maxChanges`: the rest are left out. */
  readonly truncated: boolean;
}

/** `GET /api/git/status`: the repository a folder is in, or `null` when it is in none. */
export interface GitStatusDto {
  /** The folder asked about. */
  readonly path: string;
  readonly repository: GitRepositoryDto | null;
}

/** One commit of the log. */
export interface GitCommitDto {
  readonly hash: string;
  readonly short: string;
  readonly author: string;
  readonly email: string;
  /** ISO time the author made it. */
  readonly date: string;
  readonly subject: string;
  /** Branches and tags pointing at it, `HEAD -> main`, `origin/main`, `tag: v1`. */
  readonly refs: readonly string[];
}

export interface GitLogDto {
  readonly root: string;
  readonly commits: readonly GitCommitDto[];
  /** There are older commits than these. */
  readonly more: boolean;
}

/** A branch, local or on a remote. */
export interface GitBranchDto {
  /** `main`, or `origin/main` for a remote one. */
  readonly name: string;
  readonly remote: boolean;
  readonly current: boolean;
  /** Short hash of the commit it points at. */
  readonly commit: string;
  /** What a local branch tracks. */
  readonly upstream: string | null;
}

export interface GitBranchesDto {
  readonly root: string;
  readonly branches: readonly GitBranchDto[];
}

/** One file's changes, as `git diff` prints them. */
export interface GitDiffDto {
  readonly root: string;
  readonly file: string;
  /** The staged changes (index against HEAD) rather than the unstaged ones. */
  readonly staged: boolean;
  /** Unified diff text; empty when nothing differs. */
  readonly text: string;
  /** Git calls it binary: there are no lines to show. */
  readonly binary: boolean;
  /** Longer than `GIT_LIMITS.maxDiffBytes`: `text` is cut there. */
  readonly truncated: boolean;
}

/** Bounds on what one request may cost. */
export const GIT_LIMITS = {
  /** A status lists at most this many changes. */
  maxChanges: 5000,
  /** A diff is cut here. */
  maxDiffBytes: 2 * 1024 * 1024,
  /** The most commits one log request returns. */
  maxLog: 200,
  /** Commits a log returns when not told. */
  defaultLog: 50,
  /** A command that reads or changes only this computer's repository. */
  localTimeoutMs: 60_000,
  /** One that talks to a remote, or runs hooks (commit): a slow network, a long pre-commit. */
  longTimeoutMs: 10 * 60_000,
} as const;
