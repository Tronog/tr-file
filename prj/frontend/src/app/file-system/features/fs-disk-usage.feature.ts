import type { FileSystemService } from '../file-system.service';
import type { FsDiskUsageReport, FsDiskUsageScan } from '../file-system.model';

/**
 * Disk usage scans on the backend (PRD 013, §1): started on a folder, asked
 * how far they have got — with the part of the tree a panel shows — and
 * stopped. Stateless, like the other features here; `DiskUsageFeature` in
 * the workbench keeps the scans and polls them.
 */
export class FsDiskUsageFeature {
  constructor(private readonly parent: FileSystemService) {}

  start(path: string, depth?: number): Promise<FsDiskUsageScan> {
    return this.parent.transport.startDiskUsage(path, depth);
  }

  status(id: string, report: FsDiskUsageReport = {}): Promise<FsDiskUsageScan> {
    return this.parent.transport.diskUsageStatus(id, report);
  }

  cancel(id: string): Promise<FsDiskUsageScan> {
    return this.parent.transport.cancelDiskUsage(id);
  }
}
