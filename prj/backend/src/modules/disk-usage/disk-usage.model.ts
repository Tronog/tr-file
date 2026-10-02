/**
 * Disk usage (PRD 013, §1): what takes up the space under a folder, worked out
 * by a scan that runs on the backend and is asked how far it has got.
 */

/** How deep a scan goes below the folder it was started on (PRD 013, §1). */
export const DISK_USAGE_MAX_DEPTH = 100;

export const DISK_USAGE_LIMITS = {
  /** The deepest tree a report draws below the folder asked about. */
  maxReportDepth: 8,
  /** The entries a folder of a report lists, largest first; the rest are one `rest` entry. */
  childrenPerFolder: 100,
  /** The files a folder keeps by name, largest first; smaller ones are summed. */
  filesPerFolder: 100,
  /** Folders read at once. */
  concurrency: 8,
  /** Entries `lstat`ed at once within a folder. */
  statBatch: 64,
  /** Scans kept at once; the oldest finished one goes first. */
  maxScans: 16,
  /** A running scan no one has asked about for this long is stopped. */
  abandonedMs: 2 * 60_000,
  /** A finished scan no one has asked about for this long is forgotten. */
  forgottenMs: 30 * 60_000,
} as const;

export type DiskUsageScanState = 'running' | 'done' | 'cancelled' | 'failed';

/**
 * How far a folder of the tree is: `scanning` while it or a folder below it is
 * still to be read, `done` once all of it is in. A folder that was not gone
 * into says why: `unreadable`, `too-deep` (past `DISK_USAGE_MAX_DEPTH`), or
 * `mount` — another file system, which a scan does not cross into.
 */
export type DiskUsageFolderState = 'scanning' | 'done' | 'unreadable' | 'too-deep' | 'mount';

/** One entry of a report: a folder (with what it holds, to the depth asked), a file, or the rest summed. */
export interface DiskUsageNodeDto {
  readonly kind: 'folder' | 'file' | 'rest';
  readonly name: string;
  /** Root-relative; `null` for `rest`, which is no one entry. */
  readonly path: string | null;
  /** Bytes, as the files' sizes add up. */
  readonly size: number;
  /** Bytes the disk gives them (allocated blocks), where the system says. */
  readonly onDisk: number;
  /** Files and folders beneath a folder; for `rest`, the files it stands for. */
  readonly files: number;
  readonly folders: number;
  /** For `rest`: how many entries it stands for. */
  readonly count?: number;
  readonly state?: DiskUsageFolderState;
  /** A folder's entries, largest first — present only within the depth asked. */
  readonly children?: readonly DiskUsageNodeDto[];
}

export interface DiskUsageTotalsDto {
  readonly size: number;
  readonly onDisk: number;
  readonly files: number;
  readonly folders: number;
  /** Folders that could not be read. */
  readonly errors: number;
  /** Folders not gone into: other file systems, or past the depth. */
  readonly skipped: number;
}

/** What a scan has found so far, and — when asked — the tree under one of its folders. */
export interface DiskUsageScanDto {
  readonly id: string;
  /** The folder scanned, root-relative. */
  readonly path: string;
  readonly state: DiskUsageScanState;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly elapsedMs: number;
  readonly maxDepth: number;
  readonly totals: DiskUsageTotalsDto;
  /** The folder being read, root-relative, while running. */
  readonly current: string | null;
  readonly error?: string;
  /** `tree` is `null` for a folder of the scan not reached yet. */
  readonly report?: { readonly path: string; readonly depth: number; readonly tree: DiskUsageNodeDto | null };
}

/** What to report with a scan's status: the tree under `path`, `depth` levels of it. */
export interface DiskUsageReportRequest {
  readonly path?: string;
  readonly depth?: number;
}
