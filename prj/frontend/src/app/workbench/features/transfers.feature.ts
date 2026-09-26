import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { UiTransfer } from '@tr-file/ui';
import type {
  FsDownload,
  FsDownloadResult,
  FsUpload,
  FsUploadProgress,
} from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

type TransferStatus = 'active' | 'done' | 'error' | 'cancelled';

/** One transfer the workbench is tracking, live progress included. */
interface TransferRecord {
  readonly id: string;
  readonly direction: 'upload' | 'download';
  readonly name: string;
  /** Where an upload lands, or the path a download comes from. */
  readonly path: string;
  readonly progress: Signal<FsUploadProgress>;
  readonly status: TransferStatus;
  /** Bytes actually stored or saved, known once the transfer finishes. */
  readonly bytes?: number;
  /** How a finished download ended. */
  readonly outcome?: FsDownloadResult['outcome'];
  readonly error?: FsError;
  readonly cancel: () => void;
}

/**
 * Uploads and downloads in flight, and what became of them.
 *
 * Each record keeps the progress signal handed back by `FsTransferFeature`, so
 * the panel rows are a computed over live signals rather than something that
 * has to be polled. A finished upload refreshes the directory it landed in,
 * which is what makes the new file appear in every panel showing that folder.
 *
 * Downloads are rows too (PRD 003, §1), so a failure is shown where the user
 * looks rather than in the console. On the desktop the main process streams
 * the file and reports real progress; over HTTP the browser saves it, so the
 * row says the file was handed over — after a check that would have failed it
 * with the server's reason.
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

  /** Saves a file to the user's disk, tracked as a row like any upload. */
  download(path: string, name: string): void {
    this.sequence += 1;
    const id = `download-${this.sequence}`;
    const download: FsDownload = this.parent.fileSystem.transferFt.save(path, name);

    this.records.update((records) => [
      {
        id,
        direction: 'download',
        name,
        path,
        progress: download.progress,
        status: 'active',
        cancel: () => {
          download.cancel();
          this.settle(id, 'cancelled');
        },
      },
      ...records,
    ]);

    void download.result.then(
      (result) => {
        if (result.outcome === 'dismissed') {
          // Closing the Save dialog is a change of mind, not something to
          // keep a row about.
          this.records.update((records) => records.filter((record) => record.id !== id));
          return;
        }
        this.settle(id, 'done', undefined, result.bytes, result.outcome);
      },
      (error: unknown) => {
        const failure = FsError.from(error);
        this.settle(id, failure.code === 'ABORTED' ? 'cancelled' : 'error', failure);
      },
    );
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
        direction: 'upload',
        name: file.name,
        path: directoryPath,
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

  private settle(
    id: string,
    status: TransferStatus,
    error?: FsError,
    bytes?: number,
    outcome?: FsDownloadResult['outcome'],
  ): void {
    this.records.update((records) =>
      records.map((record) =>
        record.id === id && record.status === 'active'
          ? {
              ...record,
              status,
              ...(error ? { error } : {}),
              ...(bytes === undefined ? {} : { bytes }),
              ...(outcome === undefined ? {} : { outcome }),
            }
          : record,
      ),
    );
  }

  private toRow(record: TransferRecord): UiTransfer {
    const progress = record.progress();
    const files = this.parent.fileViewModel;
    const upload = record.direction === 'upload';
    const name = upload ? `${record.name} → ${record.path || '/'}` : `${record.name} ← ${record.path}`;

    switch (record.status) {
      case 'done':
        return {
          id: record.id,
          name,
          icon: 'check',
          iconColor: 'var(--vsc-git-untracked)',
          progress: 100,
          statusLabel:
            record.outcome === 'delegated'
              ? 'sent to browser'
              : // The response says what was stored; progress events can be
                // absent altogether for a small body.
                `${upload ? 'done' : 'saved'} · ${files.formatBytes(record.bytes ?? progress.loaded)}`,
        };
      case 'error':
        return {
          id: record.id,
          name,
          icon: 'alert-triangle',
          iconColor: 'var(--vsc-git-conflict)',
          progress: 100,
          statusLabel: this.reasonOf(record.error),
        };
      case 'cancelled':
        return {
          id: record.id,
          name,
          icon: 'x',
          iconColor: 'var(--vsc-fg-dim)',
          progress: 100,
          statusLabel: 'cancelled',
        };
      default:
        return {
          id: record.id,
          name,
          icon: upload ? 'upload' : 'download',
          iconColor: 'var(--vsc-accent)',
          progress: progress.percent,
          statusLabel:
            progress.percent === null
              ? upload
                ? 'uploading…'
                : 'starting…'
              : `${progress.percent}% · ${files.formatBytes(progress.loaded)}`,
        };
    }
  }

  /** A failure, in the few words a row has room for. */
  private reasonOf(error: FsError | undefined): string {
    switch (error?.code) {
      case 'CONFLICT':
        return 'already exists';
      case 'NOT_FOUND':
        return 'failed · not found';
      case 'FORBIDDEN':
        return 'failed · permission denied';
      case 'PAYLOAD_TOO_LARGE':
        return 'failed · too large';
      case 'NETWORK_ERROR':
        return 'failed · server unreachable';
      default:
        return 'failed';
    }
  }
}
