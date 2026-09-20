import { Service } from '@angular/core';
import type { MockTransfer } from './mock-data.model';

/**
 * The mocked contents of the Transfers panel.
 *
 * Static by design: PRD 001 Section 6 ports the design only, so nothing here
 * ticks. A real implementation would stream progress from the backend.
 */
@Service()
export class MockDataTransfersService {
  readonly transfers: readonly MockTransfer[] = [
    {
      id: 'upload-lock',
      name: 'pnpm-lock.yaml → s3://backups',
      direction: 'upload',
      progress: 72,
      statusLabel: '72% · 1.4 MB/s',
    },
    {
      id: 'download-modules',
      name: 'node_modules.tar.zst',
      direction: 'download',
      progress: null,
      statusLabel: 'queued',
    },
    {
      id: 'copy-docs',
      name: 'docs/ai → /mnt/nas/docs',
      direction: 'copy',
      progress: 100,
      statusLabel: 'done · 5 files',
    },
  ];
}
