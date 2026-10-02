import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import { HttpError, type Logger } from '../../core/index.js';
import { FilePathResolver } from '../files/index.js';
import { DiskUsageScan } from './disk-usage-scan.js';
import {
  DISK_USAGE_LIMITS,
  DISK_USAGE_MAX_DEPTH,
  type DiskUsageReportRequest,
  type DiskUsageScanDto,
} from './disk-usage.model.js';

/**
 * Disk usage scans (PRD 013, §1): started on a folder, run in the background,
 * and asked how far they have got — the frontend asks every 3 seconds, with
 * the folder and depth its panel shows, and is answered with that part of the
 * tree as it stands. A scan stays to be asked about once it is done, so going
 * into a folder of it costs nothing; one nobody asks about any more is
 * stopped, then forgotten.
 */
export class DiskUsageService {
  private readonly scans = new Map<string, DiskUsageScan>();

  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
  ) {}

  /** Starts a scan of the folder `path`; answers with it at once, with its first report. */
  async start(path: string | undefined, report: DiskUsageReportRequest = {}): Promise<DiskUsageScanDto> {
    this.sweep();
    const resolved = await this.resolver.resolveReal(path);
    if (resolved.absolute === '') {
      throw HttpError.badRequest('Choose a drive to scan');
    }
    let stats;
    try {
      stats = await stat(resolved.absolute);
    } catch {
      throw HttpError.notFound(`No such folder: ${FilePathResolver.shown(resolved.relative)}`);
    }
    if (!stats.isDirectory()) {
      throw HttpError.badRequest('Only a folder can be scanned');
    }
    const skip = resolved.relative === '' ? new Set(this.resolver.reservedNames) : new Set<string>();
    const scan = new DiskUsageScan(randomUUID(), resolved.relative, resolved.absolute, skip);
    this.scans.set(scan.id, scan);
    this.logger.debug('disk usage scan started', { id: scan.id, path: scan.path });
    void scan.finished.then(() =>
      this.logger.debug('disk usage scan ended', { id: scan.id, state: scan.state, files: scan.totals.files, elapsedMs: this.elapsed(scan) }),
    );
    return this.describe(scan, { path: scan.path, depth: report.depth ?? 1 });
  }

  /** How far a scan has got, with the tree under `report.path` (its own folder by default). */
  status(id: string, report: DiskUsageReportRequest = {}): DiskUsageScanDto {
    this.sweep();
    const scan = this.scanOf(id);
    scan.lastAsked = Date.now();
    return this.describe(scan, report);
  }

  cancel(id: string): DiskUsageScanDto {
    const scan = this.scanOf(id);
    scan.cancel();
    return this.describe(scan, {});
  }

  /** Stops every scan; for a host shutting down. */
  close(): void {
    for (const scan of this.scans.values()) {
      scan.cancel();
    }
    this.scans.clear();
  }

  private scanOf(id: string): DiskUsageScan {
    const scan = this.scans.get(id);
    if (scan === undefined) {
      throw HttpError.notFound('No such disk usage scan');
    }
    return scan;
  }

  private describe(scan: DiskUsageScan, request: DiskUsageReportRequest): DiskUsageScanDto {
    const dto: DiskUsageScanDto = {
      id: scan.id,
      path: scan.path,
      state: scan.state,
      startedAt: scan.startedAt.toISOString(),
      finishedAt: scan.finishedAt?.toISOString() ?? null,
      elapsedMs: this.elapsed(scan),
      maxDepth: DISK_USAGE_MAX_DEPTH,
      totals: scan.totals,
      current: scan.current,
      ...(scan.error === undefined ? {} : { error: scan.error }),
    };
    if (request.path === undefined && request.depth === undefined) {
      return dto;
    }
    const path = DiskUsageService.clean(request.path ?? scan.path);
    const depth = Math.min(Math.max(Math.trunc(request.depth ?? 1), 0), DISK_USAGE_LIMITS.maxReportDepth);
    const tree = scan.report(path, depth);
    if (tree === undefined) {
      throw HttpError.badRequest('That folder is not in the scan');
    }
    return { ...dto, report: { path, depth, tree } };
  }

  /** `/docs/` → `docs`: a report's folder as the scan names its folders. */
  private static clean(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  private elapsed(scan: DiskUsageScan): number {
    return (scan.finishedAt ?? new Date()).getTime() - scan.startedAt.getTime();
  }

  /** Stops scans nobody asks about, forgets old ones, and keeps at most `maxScans`. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, scan] of this.scans) {
      const idle = now - scan.lastAsked;
      if (scan.state === 'running' && idle > DISK_USAGE_LIMITS.abandonedMs) {
        scan.cancel();
      } else if (scan.state !== 'running' && idle > DISK_USAGE_LIMITS.forgottenMs) {
        this.scans.delete(id);
      }
    }
    const byAge = [...this.scans.values()].sort((a, b) => a.lastAsked - b.lastAsked);
    while (this.scans.size >= DISK_USAGE_LIMITS.maxScans && byAge.length > 0) {
      const oldest = byAge.shift() as DiskUsageScan;
      oldest.cancel();
      this.scans.delete(oldest.id);
    }
  }
}

