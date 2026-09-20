import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { UiTransfer } from '@tr-file/ui';
import type { FsUpload, FsUploadProgress } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

type TransferStatus = 'active' | 'done' | 'error' | 'cancelled';

/** One upload the workbench is tracking, live progress included. */
interface TransferRecord {
  readonly id: string;
  readonly name: string;
  readonly directoryPath: string;
  readonly progress: Signal<FsUploadProgress>;
  readonly status: TransferStatus;
  /** Bytes actually stored, known once the upload finishes. */
  readonly storedBytes?: number;
  readonly error?: FsError;
  readonly cancel: () => void;
}

/**
 * Uploads in flight and what became of them.
 *
 * Each record keeps the progress signal handed back by `FsTransferFeature`, so
 * the panel rows are a computed over live signals rather than something that
 * has to be polled. A finished upload refreshes the directory it landed in,
 * which is what makes the new file appear in every panel showing that folder.
 *
 * Downloads are deliberately not tracked: the backend answers with
 * `Content-Disposition: attachment`, so handing the URL to the browser lets it
 * stream the file to disk without pulling it through memory first.
 */
export class TransfersFeature {
  private readonly records: WritableSignal<readonly TransferRecord[]>;
  private sequence = 0;

  constructor(private readonly parent: WorkbenchService) {
    this.records = signal<readonly TransferRecord[]>([]);
  }

  /** Rows for `ui-transfer-list`, newest first. */
  readonly rows = computed<readonly UiTransfer[]>(() =>
    this.records().map((record) => this.toRow(record)),
  );

  readonly activeCount = computed(
    () => this.records().filter((record) => record.status === 'active').length,
  );

  readonly hasFinished = computed(() =>
    this.records().some((record) => record.status !== 'active'),
  );

  /** Starts one upload per file into `directoryPath`. */
  uploadFiles(directoryPath: string, files: readonly File[]): void {
    for (const file of files) {
      this.startUpload(directoryPath, file);
    }
  }

  /** Hands the download URL to the browser, which streams it to disk. */
  download(path: string, name: string): void {
    const anchor = document.createElement('a');
    anchor.href = this.parent.fileSystem.transferFt.downloadUrl(path);
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  cancel(id: string): void {
    this.records().find((record) => record.id === id)?.cancel();
  }

  /** Clears everything that is no longer running (the panel's bin button). */
  clearFinished(): void {
    this.records.update((records) => records.filter((record) => record.status === 'active'));
  }

  private startUpload(directoryPath: string, file: File): void {
    this.sequence += 1;
    const id = `upload-${this.sequence}`;
    const upload: FsUpload = this.parent.fileSystem.transferFt.upload(directoryPath, file, {
      overwrite: false,
    });

    this.records.update((records) => [
      {
        id,
        name: file.name,
        directoryPath,
        progress: upload.progress,
        status: 'active',
        cancel: () => {
          upload.cancel();
          this.settle(id, 'cancelled');
        },
      },
      ...records,
    ]);

    void upload.result.then(
      (details) => {
        this.settle(id, 'done', undefined, details.size);
        // The directory now has one more file; everything showing it re-reads.
        this.parent.fsDataFt.invalidateListing(directoryPath);
      },
      (error: unknown) => {
        const failure = FsError.from(error);
        this.settle(id, failure.code === 'ABORTED' ? 'cancelled' : 'error', failure);
      },
    );
  }

  private settle(id: string, status: TransferStatus, error?: FsError, storedBytes?: number): void {
    this.records.update((records) =>
      records.map((record) =>
        record.id === id && record.status === 'active'
          ? {
              ...record,
              status,
              ...(error ? { error } : {}),
              ...(storedBytes === undefined ? {} : { storedBytes }),
            }
          : record,
      ),
    );
  }

  private toRow(record: TransferRecord): UiTransfer {
    const progress = record.progress();
    switch (record.status) {
      case 'done':
        return {
          id: record.id,
          name: `${record.name} → ${record.directoryPath || '/'}`,
          icon: 'check',
          iconColor: 'var(--vsc-git-untracked)',
          progress: 100,
          // The response says what was stored; upload-progress events can be
          // absent altogether for a small body.
          statusLabel: `done · ${this.parent.fileViewModel.formatBytes(record.storedBytes ?? progress.loaded)}`,
        };
      case 'error':
        return {
          id: record.id,
          name: `${record.name} → ${record.directoryPath || '/'}`,
          icon: 'alert-triangle',
          iconColor: 'var(--vsc-git-conflict)',
          progress: 100,
          statusLabel: record.error?.code === 'CONFLICT' ? 'already exists' : 'failed',
        };
      case 'cancelled':
        return {
          id: record.id,
          name: `${record.name} → ${record.directoryPath || '/'}`,
          icon: 'x',
          iconColor: 'var(--vsc-fg-dim)',
          progress: 100,
          statusLabel: 'cancelled',
        };
      default:
        return {
          id: record.id,
          name: `${record.name} → ${record.directoryPath || '/'}`,
          icon: 'upload',
          iconColor: 'var(--vsc-accent)',
          progress: progress.percent,
          statusLabel:
            progress.percent === null
              ? 'uploading…'
              : `${progress.percent}% · ${this.parent.fileViewModel.formatBytes(progress.loaded)}`,
        };
    }
  }
}
