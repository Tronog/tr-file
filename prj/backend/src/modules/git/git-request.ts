import { HttpError } from '../../core/index.js';
import { GIT_LIMITS } from './git.model.js';

/**
 * Everything the git module can be asked (PRD 011, §1). Reads are `GET`s over
 * HTTP; every other action changes the repository, and is a `POST`.
 */
export type GitAction =
  | 'info'
  | 'status'
  | 'log'
  | 'branches'
  | 'diff'
  | 'init'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'checkout'
  | 'branch-create'
  | 'branch-delete'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'stash'
  | 'stash-pop';

export const GIT_READ_ACTIONS = ['info', 'status', 'log', 'branches', 'diff'] as const satisfies readonly GitAction[];

export const GIT_WRITE_ACTIONS = [
  'init',
  'stage',
  'unstage',
  'discard',
  'commit',
  'checkout',
  'branch-create',
  'branch-delete',
  'fetch',
  'pull',
  'push',
  'stash',
  'stash-pop',
] as const satisfies readonly GitAction[];

const ACTIONS: ReadonlySet<string> = new Set<string>([...GIT_READ_ACTIONS, ...GIT_WRITE_ACTIONS]);

/**
 * One request, validated. `path` is always a folder of the root — the one
 * shown — and the repository is the one it is in; `files` are relative to
 * that repository, as its status named them.
 */
export type GitRequest =
  | { readonly action: 'info' }
  | { readonly action: 'status' | 'branches' | 'init' | 'fetch' | 'pull' | 'push' | 'stash-pop'; readonly path: string }
  | { readonly action: 'log'; readonly path: string; readonly limit: number; readonly skip: number }
  | { readonly action: 'diff'; readonly path: string; readonly file: string; readonly staged: boolean }
  /** `files` empty means every change. */
  | { readonly action: 'stage' | 'unstage'; readonly path: string; readonly files: readonly string[] }
  | { readonly action: 'discard'; readonly path: string; readonly files: readonly string[] }
  | { readonly action: 'commit'; readonly path: string; readonly message: string; readonly amend: boolean; readonly all: boolean }
  | { readonly action: 'checkout'; readonly path: string; readonly branch: string }
  | { readonly action: 'branch-create'; readonly path: string; readonly name: string; readonly checkout: boolean }
  | { readonly action: 'branch-delete'; readonly path: string; readonly name: string; readonly force: boolean }
  | { readonly action: 'stash'; readonly path: string; readonly message: string };

export function isGitAction(value: unknown): value is GitAction {
  return typeof value === 'string' && ACTIONS.has(value);
}

/**
 * Narrows an untrusted request — a query string, a JSON body, a bridge
 * command — to a `GitRequest`. Shared by the routes and the bridge so both
 * refuse the same things in the same words, as `parseOperationRequest` is.
 */
export function parseGitRequest(action: GitAction, body: unknown): GitRequest {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (action === 'info') {
    return { action };
  }
  const path = readString(value, 'path');
  switch (action) {
    case 'status':
    case 'branches':
    case 'init':
    case 'fetch':
    case 'pull':
    case 'push':
    case 'stash-pop':
      return { action, path };
    case 'log':
      return {
        action,
        path,
        limit: Math.min(readCount(value, 'limit') ?? GIT_LIMITS.defaultLog, GIT_LIMITS.maxLog),
        skip: readCount(value, 'skip') ?? 0,
      };
    case 'diff':
      return { action, path, file: readFile(readString(value, 'file')), staged: readFlag(value, 'staged') };
    case 'stage':
    case 'unstage':
    case 'discard': {
      const files = readFiles(value);
      if (action === 'discard' && files.length === 0) {
        throw HttpError.badRequest('Name the files whose changes to discard');
      }
      return { action, path, files };
    }
    case 'commit': {
      const message = typeof value['message'] === 'string' ? value['message'] : '';
      const amend = readFlag(value, 'amend');
      if (message.trim() === '' && !amend) {
        throw HttpError.badRequest('Write a commit message');
      }
      return { action, path, message, amend, all: readFlag(value, 'all') };
    }
    case 'checkout':
      return { action, path, branch: readBranch(value, 'branch') };
    case 'branch-create':
      return { action, path, name: readBranch(value, 'name'), checkout: value['checkout'] !== false };
    case 'branch-delete':
      return { action, path, name: readBranch(value, 'name'), force: readFlag(value, 'force') };
    case 'stash':
      return { action, path, message: typeof value['message'] === 'string' ? value['message'].trim() : '' };
  }
}

function readString(value: Record<string, unknown>, field: string): string {
  const raw = value[field];
  if (typeof raw !== 'string') {
    throw HttpError.badRequest(`"${field}" must be a string`);
  }
  return raw;
}

/** `true` / `'true'` / `'1'` — a JSON flag, or the same flag in a query string. */
function readFlag(value: Record<string, unknown>, field: string): boolean {
  const raw = value[field];
  return raw === true || raw === 'true' || raw === '1';
}

function readCount(value: Record<string, unknown>, field: string): number | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  const count = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw HttpError.badRequest(`"${field}" must be a non-negative integer`);
  }
  return count;
}

function readFiles(value: Record<string, unknown>): string[] {
  const raw = value['files'] ?? [];
  if (!Array.isArray(raw) || !raw.every((file): file is string => typeof file === 'string')) {
    throw HttpError.badRequest('"files" must be an array of paths');
  }
  return raw.map(readFile);
}

/**
 * A file as the repository's status named it: relative, `/`-separated, and
 * never climbing out. Git would refuse a path outside the repository too;
 * this refuses it before git is started at all.
 */
function readFile(file: string): string {
  const cleaned = file.replace(/\\/g, '/').replace(/\/+$/, '');
  if (
    cleaned === '' ||
    cleaned.includes('\0') ||
    cleaned.startsWith('/') ||
    /^[A-Za-z]:/.test(cleaned) ||
    cleaned.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw HttpError.badRequest(`Not a file of the repository: ${file}`);
  }
  return cleaned;
}

/**
 * A branch name git would take — its `check-ref-format` rules, kept here so
 * a name starting with `-` can never be read as an option.
 */
function readBranch(value: Record<string, unknown>, field: string): string {
  const name = readString(value, field).trim();
  const invalid =
    name === '' ||
    name.length > 250 ||
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.endsWith('.lock') ||
    name === '@' ||
    name.includes('..') ||
    name.includes('//') ||
    name.includes('@{') ||
    /[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) ||
    name.split('/').some((part) => part.startsWith('.'));
  if (invalid) {
    throw HttpError.badRequest(`'${name}' is not a valid branch name`);
  }
  return name;
}
