import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiProgressDialogModel, UiTransfer } from '@tr-file/ui';
import type {
  FsConflictPolicy,
  FsOperationDecision,
  FsOperationJob,
  FsOperationRequest,
  FsOperationsInfo,
} from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import { OperationProgressModal } from '../operations/operation-progress-modal';
import type { WorkbenchService } from '../workbench.service';

/** How often a running job is asked how far it has got (PRD 005, §1). */
export const OPERATION_POLL_MS = 1000;

/** How many names a confirmation lists before it says "and N more". */
const LISTED_NAMES = 10;

/** One job the workbench is following. */
interface OperationRecord {
  readonly job: FsOperationJob;
  /** Entries the job takes away from where they were: a move's sources, what is trashed. */
  readonly removes: readonly string[];
  readonly cancelling: boolean;
  /**
   * Whether it has had its chance at a window: a job still running at the
   * first poll gets one, once. Closing it sends the job to the background.
   */
  readonly windowed: boolean;
  /**
   * Who asked for it: the user — recorded with Undo once it ends — or Undo
   * itself, which is not (PRD 003, §5).
   */
  readonly origin: 'user' | 'undo';
  /** The panel it was started from, whose content gets the keyboard back when it ends (PRD 001, Fix 5). */
  readonly groupId: string;
}

/**
 * File operations (PRD 005, §1): copy, move, move to trash and empty trash —
 * and, since PRD 003 §5, delete for good and restore from the trash.
 *
 * All of them run on the backend, as jobs — the local one or a remote server,
 * whichever the window is on; on the desktop against its own machine, trash is
 * the system's. This feature starts them and follows them:
 *
 * - **asking first** — where to (copy, move), what to do about names that are
 *   taken (Replace / Keep Both / Skip), and, for anything that deletes, whether
 *   the user is sure: moving to the trash and emptying it are always confirmed;
 * - **polling** — each running job is asked for its progress once a second,
 *   however fast it moves, so neither the UI nor the channel is flooded;
 * - **showing** — a job still running at its first poll opens a progress
 *   window with *Run in Background* and *Cancel*; the bottom panel's Progress
 *   tab lists every job, with a stop button on each that is running;
 * - **tidying up** — a finished job re-reads every folder it changed, and
 *   drops what it took away from the panels' selections.
 */
export class OperationsFeature {
  private readonly records: WritableSignal<readonly OperationRecord[]>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly parent: WorkbenchService) {
    this.records = signal<readonly OperationRecord[]>([]);
  }

  /** Rows for the Progress tab, newest first. */
  readonly rows = computed<readonly UiTransfer[]>(() => this.records().map((record) => this.toRow(record)));

  readonly runningCount = computed(() => this.records().filter((record) => OperationsFeature.isActive(record.job)).length);

  readonly hasFinished = computed(() => this.records().some((record) => !OperationsFeature.isActive(record.job)));

  /** Whether the active panel has anything to copy, move or trash — for the File menu. */
  readonly hasSelection = computed(() => this.selectionOf(this.parent.activeGroupId(), null).length > 0);

  /* -- starting ------------------------------------------------------------ */

  /** Copies the active panel's selection, asking where to. */
  copySelection(groupId = this.parent.activeGroupId()): Promise<void> {
    return this.transferSelection('copy', groupId);
  }

  /** Moves the active panel's selection, asking where to. */
  moveSelection(groupId = this.parent.activeGroupId()): Promise<void> {
    return this.transferSelection('move', groupId);
  }

  /**
   * Moves a panel's selection to the trash, once the user has said yes. With
   * `entryId` — the key was pressed on a row — the selection counts only if
   * that row is part of it; otherwise it is that row alone.
   */
  async trashSelection(groupId = this.parent.activeGroupId(), entryId: string | null = null): Promise<void> {
    const paths = this.selectionOf(groupId, entryId);
    if (paths.length === 0) {
      await this.nothingSelected('move to the trash');
      return;
    }
    await this.trash(paths);
  }

  /**
   * Copies or moves `sources` into the folder `destination`; resolves with
   * whether a job was started. Moving entries to the folder they are already
   * in starts nothing — nor does cancelling the question about taken names.
   */
  async transfer(kind: 'copy' | 'move', sources: readonly string[], destination: string): Promise<boolean> {
    if (kind === 'move' && sources.every((source) => OperationsFeature.parentOf(source) === destination)) {
      return false;
    }
    let conflict: FsConflictPolicy = 'fail';
    for (;;) {
      try {
        const job = await this.parent.fileSystem.operationsFt.start({ kind, sources, destination, conflict, errors: 'ask' });
        this.track(job, kind === 'move' ? sources : []);
        return true;
      } catch (error) {
        const failure = FsError.from(error);
        if (failure.code === 'CONFLICT' && conflict === 'fail') {
          const decision = await this.askAboutConflicts(OperationsFeature.conflictsOf(failure), destination);
          if (decision === null) {
            return false;
          }
          conflict = decision;
          continue;
        }
        await this.refused(kind === 'copy' ? 'copy' : 'move', failure);
        return false;
      }
    }
  }

  /** Moves `paths` to the trash — after asking (PRD 005, §1). */
  async trash(paths: readonly string[]): Promise<void> {
    const info = await this.info();
    const bin = OperationsFeature.trashName(info);
    const single = paths.length === 1;
    const confirmed = await this.parent.modal.confirm({
      severity: 'warning',
      message: single
        ? `Are you sure you want to move '${OperationsFeature.nameOf(paths[0] as string)}' to the ${bin}?`
        : `Are you sure you want to move these ${paths.length} items to the ${bin}?`,
      detail: [
        ...(single ? [] : [OperationsFeature.listNames(paths)]),
        info.trash === 'system'
          ? `You can restore ${single ? 'it' : 'them'} from the ${bin}.`
          : `${single ? 'It stays' : 'They stay'} in the server's trash until it is emptied.`,
      ].join('\n\n'),
      confirmLabel: `Move to ${bin}`,
    });
    if (!confirmed) {
      return;
    }
    try {
      this.track(await this.parent.fileSystem.operationsFt.start({ kind: 'trash', paths, errors: 'ask' }), paths);
    } catch (error) {
      await this.refused('move to the trash', FsError.from(error));
    }
  }

  /**
   * Deletes a panel's selection for good — `Shift`+`Delete` (PRD 003, §5) —
   * once the user has said yes; see `trashSelection` for `entryId`.
   */
  async deleteSelection(groupId = this.parent.activeGroupId(), entryId: string | null = null): Promise<void> {
    const paths = this.selectionOf(groupId, entryId);
    if (paths.length === 0) {
      await this.nothingSelected('delete');
      return;
    }
    await this.deletePermanently(paths);
  }

  /** Deletes `paths` for good, skipping the trash — after asking, always. */
  async deletePermanently(paths: readonly string[]): Promise<void> {
    const single = paths.length === 1;
    const confirmed = await this.parent.modal.confirm({
      severity: 'warning',
      message: single
        ? `Are you sure you want to permanently delete '${OperationsFeature.nameOf(paths[0] as string)}'?`
        : `Are you sure you want to permanently delete these ${paths.length} items?`,
      detail: [...(single ? [] : [OperationsFeature.listNames(paths)]), 'This action is irreversible!'].join('\n\n'),
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }
    try {
      this.track(await this.parent.fileSystem.operationsFt.start({ kind: 'delete', paths, errors: 'ask' }), paths);
    } catch (error) {
      await this.refused('delete', FsError.from(error));
    }
  }

  /**
   * Moves `paths` to the trash without asking — Undo of something the user
   * just made, which is theirs to take back. Resolves once the job has started.
   */
  async trashQuietly(paths: readonly string[]): Promise<void> {
    this.track(await this.parent.fileSystem.operationsFt.start({ kind: 'trash', paths, errors: 'ask' }), paths, 'undo');
  }

  /** Puts trashed entries back where they came from — Undo of a move to the trash. */
  async restore(ids: readonly string[]): Promise<void> {
    this.track(await this.parent.fileSystem.operationsFt.start({ kind: 'restore', ids, errors: 'ask' }), [], 'undo');
  }

  /**
   * Copies or moves `sources` — a context menu's entries, say — asking where
   * to, as *Copy To…* and *Move To…* do for a selection.
   */
  async transferPaths(kind: 'copy' | 'move', sources: readonly string[], groupId = this.parent.activeGroupId()): Promise<void> {
    if (sources.length === 0) {
      await this.nothingSelected(kind);
      return;
    }
    const what = sources.length === 1 ? `'${OperationsFeature.nameOf(sources[0] as string)}'` : `${sources.length} items`;
    const answer = await this.parent.modal.prompt({
      message: `${kind === 'copy' ? 'Copy' : 'Move'} ${what} to:`,
      label: 'Destination folder',
      value: `/${this.defaultDestination(groupId)}`,
      confirmLabel: kind === 'copy' ? 'Copy' : 'Move',
      validate: (value) => (value.trim() === '' ? 'Type the folder to put them in, from / up.' : null),
    });
    if (answer === null) {
      return;
    }
    await this.transfer(kind, sources, OperationsFeature.cleanPath(answer));
  }

  /* -- archives (PRD 003, §6) ------------------------------------------------ */

  /**
   * *Compress…*: a zip of `sources` in the folder they are in, named after
   * the one entry — or after the folder, for several — as the user confirms.
   */
  async compress(sources: readonly string[], groupId = this.parent.activeGroupId()): Promise<boolean> {
    if (sources.length === 0) {
      await this.nothingSelected('compress');
      return false;
    }
    const folder = OperationsFeature.parentOf(sources[0] as string);
    const suggested = sources.length === 1 ? OperationsFeature.nameOf(sources[0] as string) : OperationsFeature.nameOf(folder) || 'Archive';
    const stem = suggested.replace(/\.zip$/i, '');
    const what = sources.length === 1 ? `'${OperationsFeature.nameOf(sources[0] as string)}'` : `${sources.length} items`;
    const answer = await this.parent.modal.prompt({
      message: `Compress ${what} to a zip archive in '/${folder}':`,
      label: 'Archive name',
      value: `${stem}.zip`,
      selection: [0, stem.length],
      confirmLabel: 'Compress',
      validate: (value) => (value.trim() === '' ? 'Name the archive.' : /[/\\]/.test(value) ? 'A name cannot contain / or \\.' : null),
    });
    if (answer === null) {
      return false;
    }
    const name = answer.trim();
    this.parent.editorGroupsFt.focus(groupId);
    return this.startWithConflicts('compress', folder, (conflict) => ({
      kind: 'compress',
      sources,
      destination: folder,
      name: /\.zip$/i.test(name) ? name : `${name}.zip`,
      conflict,
    }));
  }

  /**
   * *Extract Here* / *Extract To…*: a zip's contents into `destination` —
   * its one top entry straight in, or everything into a folder named after
   * it, so an archive of loose files never scatters them. Without a
   * destination the user is asked, starting from the archive's own folder.
   */
  async extract(path: string, destination?: string): Promise<boolean> {
    let into = destination;
    if (into === undefined) {
      const answer = await this.parent.modal.prompt({
        message: `Extract '${OperationsFeature.nameOf(path)}' to:`,
        label: 'Destination folder',
        value: `/${OperationsFeature.parentOf(path)}`,
        confirmLabel: 'Extract',
        validate: (value) => (value.trim() === '' ? 'Type the folder to extract into, from / up.' : null),
      });
      if (answer === null) {
        return false;
      }
      into = OperationsFeature.cleanPath(answer);
    }
    const target = into;
    return this.startWithConflicts('extract', target, (conflict) => ({ kind: 'extract', path, destination: target, conflict }));
  }

  /** Starts a job that may meet a taken name, asking about it once as copies do. */
  private async startWithConflicts(
    action: 'compress' | 'extract',
    destination: string,
    request: (conflict: FsConflictPolicy) => FsOperationRequest,
  ): Promise<boolean> {
    let conflict: FsConflictPolicy = 'fail';
    for (;;) {
      try {
        this.track(await this.parent.fileSystem.operationsFt.start(request(conflict)), []);
        return true;
      } catch (error) {
        const failure = FsError.from(error);
        if (failure.code === 'CONFLICT' && conflict === 'fail') {
          const decision = await this.askAboutConflicts(OperationsFeature.conflictsOf(failure), destination);
          if (decision === null) {
            return false;
          }
          conflict = decision;
          continue;
        }
        await this.refused(action, failure);
        return false;
      }
    }
  }

  /** Deletes everything in the trash, for good — after asking. */
  async emptyTrash(): Promise<void> {
    const info = await this.info();
    const bin = OperationsFeature.trashName(info);
    const confirmed = await this.parent.modal.confirm({
      severity: 'warning',
      message: `Are you sure you want to permanently delete everything in the ${
        info.trash === 'system' ? bin : "server's trash"
      }?`,
      detail: 'This cannot be undone.',
      confirmLabel: `Empty ${bin}`,
    });
    if (!confirmed) {
      return;
    }
    try {
      this.track(await this.parent.fileSystem.operationsFt.start({ kind: 'empty-trash' }), []);
    } catch (error) {
      await this.refused('empty the trash', FsError.from(error));
    }
  }

  /* -- following ------------------------------------------------------------ */

  /** Stops a running job. Its row says *cancelling* until the backend confirms. */
  cancel(id: string): void {
    const record = this.find(id);
    if (record === undefined || !OperationsFeature.isActive(record.job) || record.cancelling) {
      return;
    }
    this.patch(id, { cancelling: true });
    this.parent.fileSystem.operationsFt.cancel(id).then(
      (job) => this.apply(job),
      () => this.patch(id, { cancelling: false }),
    );
  }

  /** Forgets every job that has ended (the panel's bin button). */
  clearFinished(): void {
    this.records.update((records) => records.filter((record) => OperationsFeature.isActive(record.job)));
  }

  /** The job as its progress window shows it; `null` once it is gone. */
  dialogModel(id: string): UiProgressDialogModel | null {
    const record = this.find(id);
    if (record === undefined) {
      return null;
    }
    const job = record.job;
    return {
      title: job.title,
      current: job.current === null ? null : `/${job.current}`,
      progress: OperationsFeature.percentOf(job),
      status: job.state === 'done' ? this.summaryOf(job, 'Done') : this.summaryOf(job),
      // Waiting on an answer is still underway, as far as the progress window goes.
      state: job.state === 'waiting' ? 'running' : job.state,
      ...(record.cancelling ? { cancelling: true } : {}),
      ...(job.error ? { error: job.error.message } : {}),
    };
  }

  private track(job: FsOperationJob, removes: readonly string[], origin: OperationRecord['origin'] = 'user'): void {
    const groupId = this.parent.activeGroupId();
    this.records.update((records) => [{ job, removes, cancelling: false, windowed: false, origin, groupId }, ...records]);
    if (!OperationsFeature.isActive(job)) {
      this.finished(this.find(job.id) as OperationRecord);
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null || this.runningCount() === 0) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, OPERATION_POLL_MS);
  }

  /** Asks the backend about every running job, once; then again in a second while any runs. */
  private async poll(): Promise<void> {
    const running = this.records().filter((record) => OperationsFeature.isActive(record.job));
    await Promise.all(
      running.map(async (record) => {
        try {
          this.apply(await this.parent.fileSystem.operationsFt.status(record.job.id));
        } catch (error) {
          const failure = FsError.from(error);
          if (failure.status === 404) {
            // The backend has forgotten it: restarted, most likely.
            this.apply({
              ...record.job,
              state: 'failed',
              error: { code: failure.code, message: 'The server no longer knows about this operation.' },
            });
          }
          // Anything else — the network — is asked about again next time.
        }
      }),
    );
    for (const record of running) {
      const now = this.find(record.job.id);
      if (now !== undefined && OperationsFeature.isActive(now.job) && !now.windowed) {
        this.showWindow(now.job.id);
      }
    }
    this.schedule();
  }

  /** Takes in the backend's answer about a job, and tidies up after it if it has just ended. */
  private apply(job: FsOperationJob): void {
    const before = this.find(job.id);
    if (before === undefined) {
      return;
    }
    this.patch(job.id, { job, ...(OperationsFeature.isActive(job) ? {} : { cancelling: false }) });
    if (OperationsFeature.isActive(before.job) && !OperationsFeature.isActive(job)) {
      this.finished(this.find(job.id) as OperationRecord);
    }
    if (job.state === 'waiting' && !this.find(job.id)?.cancelling) {
      void this.askAbout(job);
    }
  }

  /** Jobs asked about right now, so a job still waiting at the next poll is not asked twice. */
  private readonly asking = new Set<string>();

  /**
   * A job waits on an entry it could not do (PRD 001, Fix 3): the user says
   * what to do, as Midnight Commander asks — *Skip* it, *Skip All* that fail
   * from now on, *Retry* it, or *Abort* the job. `Escape` is *Abort*, as it is
   * there. An answer that comes too late — the job was cancelled, or answered
   * elsewhere — is dropped: the next poll says how it stands.
   */
  private async askAbout(job: FsOperationJob): Promise<void> {
    const problem = job.problem;
    if (problem == null || this.asking.has(job.id)) {
      return;
    }
    this.asking.add(job.id);
    try {
      const result = await this.parent.modal.show({
        severity: 'error',
        message: `Cannot ${OperationsFeature.verbOf(job)} '${OperationsFeature.nameOf(problem.path)}'`,
        detail: `${problem.message}\n/${problem.path}`,
        buttons: [
          { id: 'skip', label: 'Skip' },
          { id: 'skip-all', label: 'Skip All' },
          { id: 'retry', label: 'Retry' },
          { id: 'abort', label: 'Abort' },
        ],
      });
      const decision = (result?.buttonId ?? 'abort') as FsOperationDecision;
      try {
        this.apply(await this.parent.fileSystem.operationsFt.resolve(job.id, decision));
      } catch {
        // Not waiting any more: cancelled meanwhile, or gone. The next poll tells.
      }
    } finally {
      this.asking.delete(job.id);
    }
    this.schedule();
  }

  /**
   * A job has ended: the folders it changed are read again, and what it took
   * away leaves the panels' selections. A failure nobody is looking at opens
   * the Progress tab, so it is not missed.
   */
  private finished(record: OperationRecord): void {
    const reread = Promise.all(record.job.affected.map((path) => this.parent.fsDataFt.invalidateListing(path)));
    // What went into or out of the trash shows in its tab (PRD 001, §14.1).
    if (['trash', 'empty-trash', 'restore'].includes(record.job.kind)) {
      this.parent.trashFt.reload();
    }
    this.reread.set(record.job.id, reread);
    // The keyboard goes back to the panel once the folders are read again —
    // the rows it stood on may be gone — and, while its progress window is
    // still up, once that closes (PRD 001, Fix 5).
    void reread.then(() => {
      if (!this.openWindows.has(record.job.id)) {
        this.parent.panelFocusFt.returnFocus(record.groupId);
      }
    });
    if (record.removes.length > 0 && record.job.state !== 'failed') {
      this.forgetRemoved(record.removes);
    }
    if (record.job.state === 'failed' && !record.windowed) {
      this.parent.bottomPanelFt.select('progress');
    }
    if (record.origin === 'user') {
      void this.recordUndo(record.job);
    }
  }

  /** What a job did goes on Undo's stack — restorable from the trash only where the trash says so. */
  private async recordUndo(job: FsOperationJob): Promise<void> {
    const canRestore = job.kind === 'trash' ? (await this.info()).canRestore === true : false;
    this.parent.undoFt.recordJob(job, canRestore);
  }

  private forgetRemoved(removed: readonly string[]): void {
    const gone = (path: string): boolean =>
      removed.some((root) => path === root || path.startsWith(`${root}/`));
    const groups = this.parent.editorGroupsFt;
    for (const group of groups.states()) {
      if (group.selection.some(gone) || (group.focusedEntryId !== undefined && gone(group.focusedEntryId))) {
        groups.update(group.id, (state) => {
          const { focusedEntryId, ...rest } = state;
          return {
            ...rest,
            selection: state.selection.filter((path) => !gone(path)),
            ...(focusedEntryId !== undefined && !gone(focusedEntryId) ? { focusedEntryId } : {}),
          };
        });
      }
    }
    this.parent.fileClipboardFt.forget(gone);
    const selected = this.parent.selectedEntryId();
    if (gone(selected)) {
      this.parent.selectedEntryId.set(OperationsFeature.parentOf(selected));
    }
  }

  /** Jobs whose progress window is open; the keyboard waits for it to close (PRD 001, Fix 5). */
  private readonly openWindows = new Set<string>();

  /** Each ended job's re-reading of the folders it changed. */
  private readonly reread = new Map<string, Promise<unknown>>();

  /** The progress window; closing it while the job runs sends it to the Progress tab. */
  private showWindow(id: string): void {
    this.patch(id, { windowed: true });
    const record = this.find(id) as OperationRecord;
    this.openWindows.add(id);
    void this.parent.modal
      .open(OperationProgressModal, {
        label: record.job.title,
        inputs: { view: computed(() => this.dialogModel(id)), cancel: () => this.cancel(id) },
      })
      .then(async () => {
        this.openWindows.delete(id);
        const ended = this.find(id);
        if (ended !== undefined && !OperationsFeature.isActive(ended.job)) {
          await this.reread.get(id);
          this.parent.panelFocusFt.returnFocus(ended.groupId);
        }
        const now = this.find(id)?.job;
        if (now !== undefined && OperationsFeature.isActive(now)) {
          this.parent.bottomPanelFt.select('progress');
        }
      });
  }

  /* -- asking --------------------------------------------------------------- */

  private transferSelection(kind: 'copy' | 'move', groupId: string): Promise<void> {
    return this.transferPaths(kind, this.selectionOf(groupId, null), groupId);
  }

  /** What a panel has selected, for copying, cutting or trashing; see `trashSelection`. */
  selectionIn(groupId: string, entryId: string | null = null): readonly string[] {
    return this.selectionOf(groupId, entryId);
  }

  /**
   * VS Code's question for names that are taken, asked once for the whole
   * request. Closing it, or *Cancel*, starts nothing.
   */
  private async askAboutConflicts(names: readonly string[], destination: string): Promise<FsConflictPolicy | null> {
    const where = `/${destination}`;
    const result = await this.parent.modal.show({
      severity: 'warning',
      message:
        names.length === 1
          ? `'${names[0]}' already exists in '${where}'. Do you want to replace it?`
          : `${names.length} items already exist in '${where}'. Do you want to replace them?`,
      detail: [
        ...(names.length === 1 ? [] : [OperationsFeature.listNames(names)]),
        'Replacing overwrites what is there. Keep Both gives the new copy a new name.',
      ].join('\n\n'),
      buttons: [
        { id: 'overwrite', label: 'Replace' },
        { id: 'rename', label: 'Keep Both' },
        { id: 'skip', label: 'Skip' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    const choice = result?.buttonId;
    return choice === 'overwrite' || choice === 'rename' || choice === 'skip' ? choice : null;
  }

  private async refused(action: string, failure: FsError): Promise<void> {
    await this.parent.modal.message({ severity: 'error', message: `Could not ${action}.`, detail: failure.message });
  }

  private async nothingSelected(action: string): Promise<void> {
    await this.parent.modal.message({
      message: `Select what to ${action} first.`,
      detail: 'Pick one or more files or folders in a panel, then try again.',
    });
  }

  private async info(): Promise<FsOperationsInfo> {
    try {
      return await this.parent.fileSystem.operationsFt.operationsInfo();
    } catch {
      return { trash: 'server' };
    }
  }

  /* -- reading the panels -------------------------------------------------------- */

  /** What a folder panel has selected: `entryId`'s selection, or the entry alone. */
  private selectionOf(groupId: string, entryId: string | null): readonly string[] {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(groupId);
    if (group === undefined || groups.activeTabOf(group)?.kind !== 'folder') {
      return [];
    }
    if (entryId !== null) {
      return group.selection.includes(entryId) ? group.selection : [entryId];
    }
    if (group.selection.length > 0) {
      return group.selection;
    }
    return group.focusedEntryId === undefined ? [] : [group.focusedEntryId];
  }

  /**
   * Where a copy or move goes unless told otherwise: the folder of the next
   * panel showing one — two panels side by side are a source and a target —
   * or, with one panel, the folder it is in.
   */
  private defaultDestination(groupId: string): string {
    const groups = this.parent.editorGroupsFt;
    const ids = this.parent.panelLayoutFt.groupIds();
    const start = ids.indexOf(groupId);
    for (let step = 1; step < ids.length; step += 1) {
      const other = groups.stateOf(ids[(start + step) % ids.length] as string);
      if (other !== undefined && groups.activeTabOf(other)?.kind === 'folder') {
        return other.path;
      }
    }
    return groups.stateOf(groupId)?.path ?? '';
  }

  /* -- rendering ---------------------------------------------------------------- */

  private toRow(record: OperationRecord): UiTransfer {
    const job = record.job;
    const icon = job.kind === 'copy' ? 'copy' : job.kind === 'move' ? 'cut' : job.kind === 'restore' ? 'sync' : 'trash';
    switch (job.state) {
      case 'done':
        return {
          id: job.id,
          name: job.title,
          icon: 'check',
          iconColor: 'var(--vsc-git-untracked)',
          progress: 100,
          statusLabel: job.skipped > 0 ? `done · ${job.skipped} skipped` : 'done',
        };
      case 'failed':
        return {
          id: job.id,
          name: job.title,
          icon: 'alert-triangle',
          iconColor: 'var(--vsc-git-conflict)',
          progress: 100,
          statusLabel: 'failed',
          ...(job.error ? { detail: job.error.message } : {}),
        };
      case 'cancelled':
        return {
          id: job.id,
          name: job.title,
          icon: 'x',
          iconColor: 'var(--vsc-fg-dim)',
          progress: 100,
          statusLabel: 'cancelled',
          // Stopped on an entry it could not do (PRD 001, Fix 3): say which, and why.
          ...(job.error ? { detail: job.error.message } : {}),
        };
      case 'waiting':
        return {
          id: job.id,
          name: job.title,
          icon: 'alert-triangle',
          iconColor: 'var(--vsc-severity-warning)',
          progress: OperationsFeature.percentOf(job),
          statusLabel: record.cancelling ? 'cancelling…' : 'waiting',
          ...(job.problem ? { detail: `${job.problem.message} — /${job.problem.path}` } : {}),
          ...(record.cancelling ? {} : { cancellable: true }),
        };
      default: {
        const percent = OperationsFeature.percentOf(job);
        return {
          id: job.id,
          name: job.title,
          icon,
          iconColor: 'var(--vsc-accent)',
          progress: percent,
          statusLabel: record.cancelling ? 'cancelling…' : percent === null ? 'working…' : `${percent}%`,
          ...(job.current === null ? {} : { detail: `/${job.current}` }),
          ...(record.cancelling ? {} : { cancellable: true }),
        };
      }
    }
  }

  /** `2 of 10 items · 1.2 MB of 4 MB · 1 skipped`, with as much as is known. */
  private summaryOf(job: FsOperationJob, prefix?: string): string {
    const format = (bytes: number): string => this.parent.fileViewModel.formatBytes(bytes);
    const parts = [
      ...(prefix ? [prefix] : []),
      job.totalItems === null
        ? `${job.doneItems} ${job.doneItems === 1 ? 'item' : 'items'}`
        : `${job.doneItems} of ${job.totalItems} ${job.totalItems === 1 ? 'item' : 'items'}`,
      ...(job.totalBytes !== null && job.totalBytes > 0
        ? [`${format(job.doneBytes)} of ${format(job.totalBytes)}`]
        : []),
      ...(job.skipped > 0 ? [`${job.skipped} skipped`] : []),
    ];
    return parts.join(' · ');
  }

  private find(id: string): OperationRecord | undefined {
    return this.records().find((record) => record.job.id === id);
  }

  private patch(id: string, change: Partial<OperationRecord>): void {
    this.records.update((records) =>
      records.map((record) => (record.job.id === id ? { ...record, ...change } : record)),
    );
  }

  /** Still underway: running, or waiting on an answer about an entry (PRD 001, Fix 3). */
  private static isActive(job: FsOperationJob): boolean {
    return job.state === 'running' || job.state === 'waiting';
  }

  /** What the job was doing to an entry, as the question about it says: `Cannot copy 'a.txt'`. */
  private static verbOf(job: FsOperationJob): string {
    switch (job.kind) {
      case 'move':
        return 'move';
      case 'trash':
        return 'move to the trash';
      case 'delete':
        return 'delete';
      case 'restore':
        return 'restore';
      default:
        return 'copy';
    }
  }

  /** Bytes when there are any to count, else entries; `null` while there is nothing to go by. */
  private static percentOf(job: FsOperationJob): number | null {
    if (job.totalBytes !== null && job.totalBytes > 0) {
      return Math.min(100, Math.round((job.doneBytes / job.totalBytes) * 100));
    }
    if (job.totalItems !== null && job.totalItems > 0) {
      return Math.min(100, Math.round((job.doneItems / job.totalItems) * 100));
    }
    return null;
  }

  private static conflictsOf(failure: FsError): readonly string[] {
    const conflicts = (failure.details as { conflicts?: unknown } | undefined)?.conflicts;
    return Array.isArray(conflicts) ? conflicts.filter((name): name is string => typeof name === 'string') : [];
  }

  /** What the user's own file manager calls it; the server's is just "trash". */
  private static trashName(info: FsOperationsInfo): string {
    if (info.trash === 'system' && /Windows/i.test(globalThis.navigator?.userAgent ?? '')) {
      return 'Recycle Bin';
    }
    return 'Trash';
  }

  private static listNames(paths: readonly string[]): string {
    const names = paths.slice(0, LISTED_NAMES).map((path) => OperationsFeature.nameOf(path));
    const more = paths.length - names.length;
    return [...names, ...(more > 0 ? [`…and ${more} more`] : [])].join('\n');
  }

  private static nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1) || path;
  }

  static parentOf(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  }

  /** `/docs/ ` → `docs`: the API's paths are root-relative, without slashes at either end. */
  private static cleanPath(value: string): string {
    return value.trim().replace(/^\/+|\/+$/g, '');
  }
}
