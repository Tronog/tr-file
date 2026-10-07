import type { Signal } from '@angular/core';

/**
 * TypeScript mirrors of the `/api/fs` contract (PRD 001, Section 7).
 *
 * These are the wire shapes, one-for-one with the backend DTOs — no view
 * concerns, no formatting. Everything is `readonly`: nothing that comes off the
 * network is ever mutated in place.
 */

/** What a directory entry is, as the backend classifies it. */
export type FsEntryType = 'file' | 'directory' | 'symlink' | 'other';

/**
 * What a symlink leads to, when that is inside the files root; `null` when it
 * is dangling or leads out of the root, so there is nothing to reach.
 */
export type FsTargetType = Exclude<FsEntryType, 'symlink'> | null;

/** One entry of a directory listing. */
export interface FsEntry {
  /** Basename; `''` for the root itself. */
  readonly name: string;
  /** Root-relative POSIX path, no leading slash. */
  readonly path: string;
  readonly type: FsEntryType;
  /** Size in bytes. */
  readonly size: number;
  /** True when the name starts with `.`. */
  readonly hidden: boolean;
  /** ISO 8601. */
  readonly modifiedAt: string;
  /** ISO 8601. */
  readonly createdAt: string;
  /** Symlinks only: what the link leads to. Absent for every other type. */
  readonly targetType?: FsTargetType;
  /**
   * An entry of a large folder (PRD 004, §3.1) whose details have not come
   * yet: its name and type are known, its size and dates are not.
   */
  readonly partial?: true;
}

/** The payload of `GET /api/fs/list`. */
export interface FsDirectoryListing {
  readonly path: string;
  /** `null` at the root. */
  readonly parent: string | null;
  /** Folders (links to folders included) first, then the rest, in natural order. */
  readonly entries: readonly FsEntry[];
  /**
   * A large folder (PRD 004, §3.1): `entries` is empty, and the folder is
   * read by stages — asked after with `listProgress(token, …)`.
   */
  readonly progressive?: {
    readonly token: string;
    /** The first names, read on the way to finding the folder large; the progress goes on after them. */
    readonly names?: readonly FsListingName[];
  };
}

/** A name of a large folder, as the directory records it. */
export interface FsListingName {
  readonly name: string;
  readonly type: FsEntryType;
}

/** What is known of one entry of a large folder, by its index among the names. */
export interface FsListingDetail {
  readonly index: number;
  readonly type: FsEntryType;
  readonly size: number;
  readonly modifiedAt: string;
  readonly createdAt: string;
  readonly targetType?: FsTargetType;
}

/**
 * The payload of `GET /api/fs/list-progress`: a large folder's reading, from
 * the caller's cursors — the names after `namesFrom`, the details after
 * `detailsFrom`. Asking again from the same place gets the same answer.
 */
export interface FsListingProgress {
  readonly path: string;
  /** `null` while the entries are still being counted. */
  readonly total: number | null;
  readonly names: readonly FsListingName[];
  readonly namesDone: boolean;
  readonly details: readonly FsListingDetail[];
  /** Indexes of entries that vanished before they could be described. */
  readonly gone: readonly number[];
  readonly done: boolean;
}

/** One `rwx` triplet of a POSIX mode. */
export interface FsPermissionTriplet {
  readonly read: boolean;
  readonly write: boolean;
  readonly execute: boolean;
}

/** The three triplets of a POSIX mode. */
export interface FsPermissions {
  readonly owner: FsPermissionTriplet;
  readonly group: FsPermissionTriplet;
  readonly others: FsPermissionTriplet;
}

/** The payload of `GET /api/fs/details`, and of a successful upload. */
export interface FsDetails extends FsEntry {
  /** `null` at the root. */
  readonly parent: string | null;
  readonly accessedAt: string;
  readonly changedAt: string;
  /** Four octal digits, e.g. `'0644'`. */
  readonly mode: string;
  readonly permissions: FsPermissions;
  readonly uid: number;
  readonly gid: number;
  readonly inode: number;
  /** `blocks * 512`. */
  readonly sizeOnDisk: number;
  /** Guessed from the extension; `null` when unknown. */
  readonly mimeType: string | null;
  /** Root-relative when the target is inside the root, else `null`. */
  readonly symlinkTarget: string | null;
  /** Directories only; `null` for anything else. */
  readonly entryCount: number | null;
  /**
   * `entryCount` is where the backend stopped counting, and there are more
   * (PRD 004, §3.1.3): a large folder is counted through only when asked.
   */
  readonly entryCountMore?: true;
}

/** Every JSON success response is wrapped in this envelope. */
export interface FsEnvelope<T> {
  readonly data: T;
}

/** Every error response body, for the statuses listed in the contract. */
export interface FsErrorBody {
  readonly error: {
    /** `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, … */
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * How far a transfer has got — an upload or a download.
 *
 * `total` and `percent` are `null` until the browser reports a content length —
 * some environments never do, so callers must handle the indeterminate case.
 */
export interface FsUploadProgress {
  readonly loaded: number;
  readonly total: number | null;
  readonly percent: number | null;
}

/**
 * A single in-flight upload.
 *
 * All of an upload's state lives on this object rather than on the feature, so
 * any number of uploads can run at once without treading on each other.
 */
export interface FsUpload {
  /** Bytes sent so far, updated as the request streams out. */
  readonly progress: Signal<FsUploadProgress>;
  /** Resolves with the stored file's details, or rejects with an `FsError`. */
  readonly result: Promise<FsDetails>;
  /** Aborts the request; `result` then rejects with an `FsError`. */
  cancel(): void;
}

/**
 * How a download ended, when it did not fail.
 *
 * - `saved` — the app wrote the file where the user chose (the desktop).
 * - `delegated` — the browser was handed the file and is saving it; what it
 *   does from there is in its own downloads list, not ours (HTTP).
 * - `dismissed` — the user closed the Save dialog. Not an error.
 */
export interface FsDownloadResult {
  readonly outcome: 'saved' | 'delegated' | 'dismissed';
  /** Bytes written, when the app wrote them itself. */
  readonly bytes?: number;
}

/**
 * A single download, shaped like `FsUpload` so the Transfers panel can track
 * both the same way (PRD 003, §1).
 */
export interface FsDownload {
  readonly progress: Signal<FsUploadProgress>;
  /** Resolves with how the download ended, or rejects with an `FsError`. */
  readonly result: Promise<FsDownloadResult>;
  /** Stops the download; `result` then rejects with an `FsError` (`ABORTED`). */
  cancel(): void;
}

/* -- file operations (PRD 005, §1) ------------------------------------------ */

export type FsOperationKind = 'copy' | 'move' | 'trash' | 'empty-trash' | 'delete' | 'restore' | 'compress' | 'extract';

/** `waiting` — paused on an entry it could not do, for an `FsOperationDecision` (PRD 001, Fix 3). */
export type FsOperationState = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';

/**
 * What a job does about an entry it cannot do: end (`fail`), or wait to be
 * told (`ask`) — see the backend's `OperationErrorPolicy`.
 */
export type FsOperationErrorPolicy = 'fail' | 'ask';

/** The answer to a waiting job, Midnight Commander's four (PRD 001, Fix 3). */
export type FsOperationDecision = 'skip' | 'skip-all' | 'retry' | 'abort';

/** Why a job waits: the entry, root-relative, and what went wrong. */
export interface FsOperationProblem {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** What to do when a name is taken at the destination; see the backend's `ConflictPolicy`. */
export type FsConflictPolicy = 'fail' | 'overwrite' | 'skip' | 'rename';

export type FsOperationRequest =
  | {
      readonly kind: 'copy' | 'move';
      readonly sources: readonly string[];
      readonly destination: string;
      readonly conflict: FsConflictPolicy;
      readonly errors?: FsOperationErrorPolicy;
    }
  | { readonly kind: 'trash'; readonly paths: readonly string[]; readonly errors?: FsOperationErrorPolicy }
  /** Deleted for good, not moved to the trash (PRD 003, §5). */
  | { readonly kind: 'delete'; readonly paths: readonly string[]; readonly errors?: FsOperationErrorPolicy }
  /** Trashed entries put back where they came from, by the ids a trash job reported. */
  | { readonly kind: 'restore'; readonly ids: readonly string[]; readonly errors?: FsOperationErrorPolicy }
  | { readonly kind: 'empty-trash' }
  /** A zip of `sources` as `destination/name` (PRD 003, §6). */
  | {
      readonly kind: 'compress';
      readonly sources: readonly string[];
      readonly destination: string;
      readonly name: string;
      readonly conflict: FsConflictPolicy;
    }
  /** A zip extracted into `destination`: its one top entry, or a folder named after it. */
  | {
      readonly kind: 'extract';
      readonly path: string;
      readonly destination: string;
      readonly conflict: FsConflictPolicy;
    };

/**
 * One entry a job has dealt with: a copy's source and the copy it made, a
 * move's old and new path, a trashed entry and the id it can be restored by,
 * a restored id and where it went back to. What Undo reads (PRD 003, §5).
 */
export interface FsOperationOutcome {
  readonly source: string;
  readonly target: string;
}

/** A background job on the backend, as `GET /api/ops/jobs/:id` answers. */
export interface FsOperationJob {
  readonly id: string;
  readonly kind: FsOperationKind;
  readonly state: FsOperationState;
  readonly title: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly totalBytes: number | null;
  readonly doneBytes: number;
  readonly totalItems: number | null;
  readonly doneItems: number;
  readonly current: string | null;
  readonly skipped: number;
  readonly error: { readonly code: string; readonly message: string } | null;
  /** While `waiting`: what it could not do, and why; absent from a server that predates it. */
  readonly problem?: FsOperationProblem | null;
  /** Folders whose listing the job changed, root-relative. */
  readonly affected: readonly string[];
  /** What became of each entry, as far as the job got; absent from a server that predates it. */
  readonly outcome?: readonly FsOperationOutcome[];
}

/** One entry in the trash (PRD 001, §14.1); see the backend's `TrashItemDto`. */
export interface FsTrashItem {
  /** What a restore knows it by. */
  readonly id: string;
  readonly name: string;
  /** Where it was — root-relative for the server's trash, the host's path for the system's; `null` when unknown. */
  readonly location: string | null;
  readonly deletedAt: string | null;
  readonly type: 'file' | 'directory' | 'symlink' | 'other';
  readonly size: number;
}

/** What is in the trash, as far as it can tell: a system trash on Windows or macOS cannot (`canList`). */
export interface FsTrashListing {
  readonly trash: 'server' | 'system';
  readonly canRestore: boolean;
  readonly canList: boolean;
  readonly items: readonly FsTrashItem[];
}

/** Whose trash a trashed entry goes to: the server's own, or the desktop's system trash. */
export interface FsOperationsInfo {
  readonly trash: 'server' | 'system';
  /** Whether trashed entries can be put back from the app — the server's own trash can. */
  readonly canRestore?: boolean;
}

/* -- search and watching (PRD 003, §5) ------------------------------------- */

/** `GET /api/fs/search`: entries under `path` whose names match `query`, shallowest first. */
export interface FsSearchResult {
  readonly path: string;
  readonly query: string;
  readonly entries: readonly FsEntry[];
  /** The search stopped early — at the result limit, or its time or size budget. */
  readonly truncated: boolean;
  /** How many entries were looked at. */
  readonly scanned: number;
}

/**
 * `POST /api/fs/watch`: the folders among those watched that changed since
 * the last ask. A `watchId` the server did not know comes back new, with every
 * folder in `changed` — it cannot say what was missed.
 */
export interface FsWatchResult {
  readonly watchId: string;
  readonly changed: readonly string[];
}

/* -- places and archives (PRD 003, §6) ------------------------------------- */

/** What a place is: which icon it gets, and where the Places pane puts it. */
export type FsPlaceKind =
  | 'root'
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'videos'
  | 'drive'
  | 'removable'
  | 'network';

export interface FsPlace {
  readonly id: string;
  readonly label: string;
  readonly kind: FsPlaceKind;
  /** Root-relative folder. */
  readonly path: string;
}

/** `GET /api/fs/places`: where a session starts, and what the Places pane lists. */
/**
 * The backend machine's clock (PRD 001, §13.1): now, its time zone and its
 * offset from UTC. A server from before it named its zone sends the time
 * alone.
 */
export interface FsServerTime {
  /** An ISO 8601 instant. */
  readonly now: string;
  readonly timeZone?: string;
  readonly utcOffsetMinutes?: number;
}

export interface FsPlaces {
  /** Root-relative; `''` is the root. */
  readonly home: string;
  readonly places: readonly FsPlace[];
}

/** One entry of a folder inside a zip. `path` is inside the archive. */
export interface FsArchiveEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory' | 'symlink';
  readonly size: number;
  readonly modifiedAt: string | null;
}

/** `GET /api/archive/list`: one folder of a zip. */
export interface FsArchiveListing {
  readonly path: string;
  readonly inner: string;
  readonly entries: readonly FsArchiveEntry[];
  /** Entries whose names would reach outside the archive — never listed or extracted. */
  readonly unsafe: number;
}

/** Files on the system clipboard, as this window can paste them (desktop only). */
export interface FsClipboardFiles {
  /** Root-relative paths of the files this window's root holds. */
  readonly paths: readonly string[];
  /** They were cut in the system's file manager, rather than copied. */
  readonly cut: boolean;
  /** Files on the clipboard this window cannot reach: outside its root, or on another computer. */
  readonly outside: number;
}

/* -- git (PRD 011, §1) ------------------------------------------------------ */

/** What `/api/git/<action>` answers to. Reads are the first five; the rest change a repository. */
export type FsGitReadAction = 'info' | 'status' | 'log' | 'branches' | 'diff';
export type FsGitWriteAction =
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
export type FsGitAction = FsGitReadAction | FsGitWriteAction;

/** The fields of an action: its query, or its body. */
export type FsGitFields = Readonly<Record<string, string | number | boolean | readonly string[]>>;

/** `GET /api/git/info`: whether the backend can run git at all. */
export interface FsGitInfo {
  readonly available: boolean;
  readonly version: string | null;
  /** Why not: not installed, or switched off on the server. */
  readonly reason: string | null;
}

export type FsGitChangeArea = 'staged' | 'unstaged' | 'untracked' | 'conflict';
export type FsGitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked' | 'conflict';

/** One changed file in one area. */
export interface FsGitChange {
  /** Root-relative, for opening. */
  readonly path: string;
  /** Relative to the repository — what a request sends back. */
  readonly file: string;
  /** A rename's source, relative to the repository. */
  readonly from?: string;
  readonly area: FsGitChangeArea;
  readonly kind: FsGitChangeKind;
  /** An untracked folder, listed whole. */
  readonly folder?: boolean;
}

export interface FsGitRepository {
  /** Root-relative folder holding `.git`. */
  readonly root: string;
  /** `null` when HEAD is detached. */
  readonly branch: string | null;
  /** Short hash; `null` before the first commit. */
  readonly head: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly hasRemote: boolean;
  readonly operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
  readonly stashes: number;
  readonly changes: readonly FsGitChange[];
  readonly truncated: boolean;
}

/** `GET /api/git/status`, and the answer of every change. */
export interface FsGitStatus {
  readonly path: string;
  /** `null`: the folder is in no repository. */
  readonly repository: FsGitRepository | null;
}

export interface FsGitCommit {
  readonly hash: string;
  readonly short: string;
  readonly author: string;
  readonly email: string;
  readonly date: string;
  readonly subject: string;
  readonly refs: readonly string[];
}

export interface FsGitLog {
  readonly root: string;
  readonly commits: readonly FsGitCommit[];
  readonly more: boolean;
}

export interface FsGitBranch {
  readonly name: string;
  readonly remote: boolean;
  readonly current: boolean;
  readonly commit: string;
  readonly upstream: string | null;
}

export interface FsGitBranches {
  readonly root: string;
  readonly branches: readonly FsGitBranch[];
}

export interface FsGitDiff {
  readonly root: string;
  readonly file: string;
  readonly staged: boolean;
  readonly text: string;
  readonly binary: boolean;
  readonly truncated: boolean;
}

/* -- disk usage (PRD 013, §1) ------------------------------------------------ */

/** How far a folder of a scan is; see the backend's `DiskUsageFolderState`. */
export type FsDiskUsageFolderState = 'scanning' | 'done' | 'unreadable' | 'too-deep' | 'mount';

/** One entry of a disk usage report: a folder (with its entries, to the depth asked), a file, or the rest summed. */
export interface FsDiskUsageNode {
  readonly kind: 'folder' | 'file' | 'rest';
  readonly name: string;
  /** Root-relative; `null` for `rest`. */
  readonly path: string | null;
  readonly size: number;
  readonly onDisk: number;
  readonly files: number;
  readonly folders: number;
  readonly count?: number;
  readonly state?: FsDiskUsageFolderState;
  readonly children?: readonly FsDiskUsageNode[];
}

export interface FsDiskUsageTotals {
  readonly size: number;
  readonly onDisk: number;
  readonly files: number;
  readonly folders: number;
  readonly errors: number;
  readonly skipped: number;
}

/** A scan on the backend, as far as it has got, with the tree under one of its folders when asked. */
export interface FsDiskUsageScan {
  readonly id: string;
  /** The folder scanned, root-relative. */
  readonly path: string;
  readonly state: 'running' | 'done' | 'cancelled' | 'failed';
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly elapsedMs: number;
  readonly maxDepth: number;
  readonly totals: FsDiskUsageTotals;
  readonly current: string | null;
  readonly error?: string;
  readonly report?: { readonly path: string; readonly depth: number; readonly tree: FsDiskUsageNode | null };
}

/** The part of a scan's tree to report: under `path`, `depth` levels of it. */
export interface FsDiskUsageReport {
  readonly path?: string;
  readonly depth?: number;
}

/* -- processes (PRD 014, §1) ------------------------------------------------ */

/** Task Manager's headings: apps, background processes, the system's. */
export type FsProcessCategory = 'app' | 'background' | 'system';

export type FsProcessStatus = 'running' | 'sleeping' | 'waiting' | 'suspended' | 'not-responding' | 'zombie' | 'idle';

/** One process of the backend machine, as last measured. */
export interface FsProcess {
  readonly pid: number;
  readonly ppid: number;
  /** Its pid and start: what *End task* names, so a pid handed out again is never ended by mistake. */
  readonly key: string;
  readonly name: string;
  readonly path: string | null;
  readonly command: string | null;
  readonly user: string | null;
  readonly title: string | null;
  readonly status: FsProcessStatus;
  readonly category: FsProcessCategory;
  /** Share of the whole machine's CPU, 0–100. */
  readonly cpu: number;
  readonly memory: number;
  /** Bytes a second; `null` when the backend may not see it. */
  readonly disk: number | null;
  readonly threads: number | null;
  readonly startedAt: string | null;
}

export interface FsProcessTotals {
  readonly cpu: number;
  readonly memoryUsed: number;
  readonly memoryTotal: number;
  readonly disk: number | null;
  readonly diskRead: number | null;
  readonly diskWrite: number | null;
  readonly processes: number;
  readonly threads: number | null;
  /** Each logical processor's load, 0–100. */
  readonly cores: readonly number[];
  /** Each network adapter's throughput, bytes a second. */
  readonly network: readonly FsNetworkAdapter[];
}

export interface FsNetworkAdapter {
  readonly name: string;
  readonly send: number;
  readonly receive: number;
}

/** What the backend machine is (PRD 014, §2.1). */
export interface FsMachineInfo {
  readonly cpuModel: string;
  readonly cpuSpeedMhz: number;
  readonly uptimeSeconds: number;
  readonly hostname: string;
}

/** The latest sample of the backend machine — `GET /api/processes`, bridge `proc-list`. */
export interface FsProcessesSnapshot {
  readonly available: boolean;
  readonly reason: string | null;
  readonly canEnd: boolean;
  readonly endReason: string | null;
  readonly sequence: number;
  readonly at: string | null;
  readonly intervalMs: number;
  readonly platform: string;
  readonly cpuCount: number;
  readonly totals: FsProcessTotals;
  readonly machine: FsMachineInfo;
  readonly processes: readonly FsProcess[];
}

export interface FsProcessSeries {
  readonly cpu: readonly number[];
  readonly memory: readonly number[];
  readonly disk: readonly (number | null)[];
}

/** The last ten minutes, one sample every `intervalMs` — `GET /api/processes/history`. */
export interface FsProcessesHistory {
  readonly intervalMs: number;
  readonly at: string | null;
  readonly totals: FsProcessSeries & {
    readonly memoryTotal: number;
    readonly diskRead: readonly (number | null)[];
    readonly diskWrite: readonly (number | null)[];
    readonly cores: readonly (readonly number[])[];
    readonly network: Readonly<Record<string, { readonly send: readonly number[]; readonly receive: readonly number[] }>>;
  };
  readonly processes: Readonly<Record<string, FsProcessSeries>>;
}

export interface FsProcessEndResult {
  readonly ended: readonly number[];
  readonly failed: readonly { readonly pid: number; readonly message: string }[];
}
