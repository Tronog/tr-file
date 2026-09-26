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

type TransferStatus = 'active' | 'done' | 'error' | 'cancelled' | 'skipped';

/**
 * One drop or pick of files. Conflicts in it are asked about one at a time,
 * and "do this for all" answers the rest of the batch.
 */
interface UploadBatch {
  readonly size: number;
  /** The answer every later conflict gets, once someone ticks "for all". */
  forAll: 'replace' | 'skip' | null;
  /** Conflicts wait for the question before them. */
  queue: Promise<unknown>;
}

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
    const batch: UploadBatch = { size: files.length, forAll: null, queue: Promise.resolve() };
    for (const file of files) {
      this.startUpload(directoryPath, file, batch);
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

  private startUpload(directoryPath: string, file: File, batch: UploadBatch): void {
    this.sequence += 1;
    const id = `upload-${this.sequence}`;
    this.records.update((records) => [
      {
        id,
        direction: 'upload',
        name: file.name,
        path: directoryPath,
        progress: signal<FsUploadProgress>({ loaded: 0, total: file.size, percent: null }),
        status: 'active',
        cancel: () => undefined,
      },
      ...records,
    ]);
    this.send(id, directoryPath, file, batch, false);
  }

  /**
   * Sends one file, into the row `id` already has. A file that is already
   * there is not a failure yet: the user is asked whether to replace it
   * (PRD 002, §3), and a yes sends it again with `overwrite`.
   */
  private send(id: string, directoryPath: string, file: File, batch: UploadBatch, overwrite: boolean): void {
    const upload: FsUpload = this.parent.fileSystem.transferFt.upload(directoryPath, file, { overwrite });
    this.records.update((records) =>
      records.map((record) =>
        record.id === id
          ? {
              ...record,
              progress: upload.progress,
              cancel: () => {
                upload.cancel();
                this.settle(id, 'cancelled');
              },
            }
          : record,
      ),
    );

    void upload.result.then(
      (details) => {
        this.settle(id, 'done', undefined, details.size);
        // The directory now has one more file; everything showing it re-reads.
        this.parent.fsDataFt.invalidateListing(directoryPath);
      },
      async (error: unknown) => {
        const failure = FsError.from(error);
        if (failure.code === 'CONFLICT' && !overwrite && this.isActive(id)) {
          const decision = await this.askAboutConflict(file.name, directoryPath, batch);
          if (!this.isActive(id)) {
            return;
          }
          if (decision === 'replace') {
            this.send(id, directoryPath, file, batch, true);
          } else {
            this.settle(id, 'skipped', failure);
          }
          return;
        }
        this.settle(id, failure.code === 'ABORTED' ? 'cancelled' : 'error', failure);
      },
    );
  }

  /**
   * VS Code's question for a name that is taken. Asked one conflict at a
   * time, however many arrive at once; with more than one file in the batch
   * it offers to answer the rest the same way. Closing the dialog skips.
   */
  private askAboutConflict(name: string, directoryPath: string, batch: UploadBatch): Promise<'replace' | 'skip'> {
    const asked = batch.queue.then(async () => {
      if (batch.forAll !== null) {
        return batch.forAll;
      }
      const result = await this.parent.modal.show({
        severity: 'warning',
        message: `A file named '${name}' already exists in '${directoryPath || '/'}'. Do you want to replace it?`,
        detail: 'Replacing it will overwrite its current contents.',
        buttons: [
          { id: 'replace', label: 'Replace' },
          { id: 'skip', label: 'Skip' },
        ],
        ...(batch.size > 1 ? { checkbox: { label: 'Do this for all remaining conflicts' } } : {}),
      });
      const decision = result?.buttonId === 'replace' ? 'replace' : 'skip';
      if (result?.checked) {
        batch.forAll = decision;
      }
      return decision;
    });
    batch.queue = asked;
    return asked;
  }

  private isActive(id: string): boolean {
    return this.records().some((record) => record.id === id && record.status === 'active');
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
      case 'skipped':
        return {
          id: record.id,
          name,
          icon: 'x',
          iconColor: 'var(--vsc-fg-dim)',
          progress: 100,
          statusLabel: record.status === 'skipped' ? 'skipped · already exists' : 'cancelled',
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
