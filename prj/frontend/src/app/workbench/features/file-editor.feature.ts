import { computed, signal } from '@angular/core';
import { parseDelimited, type UiDelimitedText, type UiDocumentEditModel, type UiSyntaxLanguage } from '@tr-file/ui';
import { contentTag } from '../../file-system/content-tag';
import { FsError } from '../../file-system/fs-error';
import { sniffText } from '../../file-system/text-sniff';
import type { WorkbenchService } from '../workbench.service';
import { LANGUAGE_LABELS, jsonProblemOf, languageOf } from './editor-language';
import { MAX_PREVIEW_BYTES } from './file-preview.feature';

/** The UTF-8 byte-order mark, kept on a file that had one. */
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/** One file open for editing. */
interface EditSession {
  /** The draft, as the editor has it — `\n` line ends. */
  readonly text: string;
  /** What is on disk, as far as is known: what was read, or last saved. */
  readonly saved: string;
  /** The `contentTag` of the bytes on disk, for the backend to check before writing over them. */
  readonly tag: string;
  /** How lines end on disk; the editor's `\n` is turned back into it on saving. */
  readonly eol: '\n' | '\r\n';
  readonly bom: boolean;
  readonly language: UiSyntaxLanguage;
  readonly saving: boolean;
}

/** What a question about unsaved changes can be answered with. */
type UnsavedAnswer = 'save' | 'discard' | 'cancel';

/**
 * The file editor (PRD 005, §4–5): a file tab turned from viewing to editing,
 * its draft, and saving it.
 *
 * One session per file, whichever tabs show it: two panels on one file edit
 * one draft. *Edit* (the toolbar's pencil, `F4`) reads the file afresh —
 * UTF-8 only, so what is saved is what was read — and turns the tab into
 * `UiCodeEditor`; *Edit* again goes back to viewing, asking about unsaved
 * changes first. *Save* (`Ctrl`+`S`) writes it back as it was: its line ends,
 * its byte-order mark, through a link to what it leads to — and the backend
 * refuses to write over a file that changed on disk since it was read
 * (`contentTag`), which is asked about: overwrite it, or take the disk's.
 *
 * A tab with unsaved changes shows a dot, and closing it asks (`canClose`),
 * as quitting does (`whenSaved`). JSON is checked as it is typed (§5): the
 * line of the first error is marked, saving it anyway is asked about, and
 * *Format Document* lays it out again.
 */
export class FileEditorFeature {
  private readonly sessions = signal<ReadonlyMap<string, EditSession>>(new Map());

  /** The last table read from each draft — a CSV file edited as one is read again only when it changed. */
  private readonly tables = new Map<string, { readonly text: string; readonly table: UiDelimitedText }>();

  /** Whether anything open for editing has unsaved changes. */
  readonly anyDirty = computed(() => [...this.sessions().values()].some((session) => session.text !== session.saved));

  constructor(private readonly parent: WorkbenchService) {
    // A browser tab closed with unsaved changes asks first. Not on the desktop: there an
    // unanswered `beforeunload` keeps the window open without a word.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (event) => {
        if (this.anyDirty() && !this.parent.desktopWindow.isAvailable) {
          event.preventDefault();
        }
      });
    }
  }

  isEditing(path: string): boolean {
    return this.sessions().has(path);
  }

  isDirty(path: string): boolean {
    const session = this.sessions().get(path);
    return session !== undefined && session.text !== session.saved;
  }

  languageOf(path: string): UiSyntaxLanguage | undefined {
    return this.sessions().get(path)?.language;
  }

  /**
   * Whether a file can be edited, as far as is known before reading it: one
   * the app can show, and not an image.
   */
  canEdit(path: string): boolean {
    return this.parent.filePreviewFt.canPreview(path) && !this.parent.images.isImage(path);
  }

  /** What the viewer is handed to draw the editor, while `path` is open for editing. */
  editModelFor(path: string): UiDocumentEditModel | undefined {
    const session = this.sessions().get(path);
    if (session === undefined) {
      return undefined;
    }
    const problem = session.language === 'json' ? jsonProblemOf(session.text) : null;
    const state = session.saving ? 'Saving…' : session.text !== session.saved ? 'Modified' : undefined;
    return {
      text: session.text,
      language: session.language,
      languageLabel: LANGUAGE_LABELS[session.language],
      ...(state === undefined ? {} : { state }),
      ...(problem === null ? {} : { problem }),
    };
  }

  /**
   * The draft of a CSV file as cells (PRD 015, §1), for the spreadsheet it is
   * edited in — whose changes come back as text, so saving, the dot and the
   * questions are the editor's own.
   */
  tableOf(path: string, delimiter: string): UiDelimitedText {
    const text = this.sessions().get(path)?.text ?? '';
    const cached = this.tables.get(path);
    if (cached !== undefined && cached.text === text && cached.table.delimiter === delimiter) {
      return cached.table;
    }
    const table = parseDelimited(text, delimiter);
    this.tables.set(path, { text, table });
    return table;
  }

  /**
   * *Edit* (`F4`, the pencil): the active panel's file, or `path` — from a
   * listing, opened in a tab first. Editing already, back to viewing it.
   */
  async toggle(groupId: string, path?: string): Promise<void> {
    const group = this.parent.editorGroupsFt.stateOf(groupId);
    const active = group === undefined ? undefined : this.parent.editorGroupsFt.activeTabOf(group);
    const target = path ?? (active?.kind === 'file' ? active.path : undefined);
    if (target === undefined) {
      return;
    }
    if (active?.kind === 'file' && active.path === target && this.isEditing(target)) {
      await this.stopEditing(groupId, target);
      return;
    }
    if (!this.canEdit(target)) {
      // Nothing the app can edit — a PDF, a picture: the system's application can (PRD 004, §2).
      await this.parent.systemOpenFt.open(target);
      return;
    }
    if (active?.kind !== 'file' || active.path !== target) {
      this.parent.fileBrowserFt.openPath(groupId, target);
    }
    if (!this.isEditing(target) && !(await this.begin(target))) {
      return;
    }
    this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
  }

  /** The draft, as the editor reports it after each change. */
  setText(path: string, text: string): void {
    const session = this.sessions().get(path);
    if (session !== undefined && session.text !== text) {
      this.patch(path, { ...session, text });
    }
  }

  /**
   * *Save* (`Ctrl`+`S`). Resolves `true` once it is on disk — or there was
   * nothing to save — and `false` when it was not saved: declined, refused.
   */
  async save(path: string): Promise<boolean> {
    const session = this.sessions().get(path);
    if (session === undefined || session.saving) {
      return session === undefined;
    }
    if (session.text === session.saved) {
      return true;
    }
    if (session.language === 'json' && jsonProblemOf(session.text) !== null) {
      const anyway = await this.parent.modal.confirm({
        message: `${this.nameOf(path)} is not valid JSON. Save it anyway?`,
        detail: jsonProblemOf(session.text)?.message ?? '',
        confirmLabel: 'Save Anyway',
      });
      if (!anyway) {
        return false;
      }
    }
    return this.write(path, session, true);
  }

  /** *Format Document* (§5): the JSON draft laid out again, indented as the file is — two spaces when it says nothing. */
  format(path: string): void {
    const session = this.sessions().get(path);
    if (session === undefined || session.language !== 'json') {
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(session.text);
    } catch {
      void this.parent.modal.message({ message: 'Only valid JSON can be formatted.', detail: jsonProblemOf(session.text)?.message ?? '', severity: 'warning' });
      return;
    }
    const indent = /^\n?([ \t]+)"/m.exec(session.text)?.[1] ?? '  ';
    const text = `${JSON.stringify(value, null, indent)}\n`;
    if (text !== session.text) {
      this.patch(path, { ...session, text });
    }
  }

  /** *Reload* while editing: the file read again — after asking, when that throws changes away. */
  async reload(path: string): Promise<void> {
    if (this.isDirty(path)) {
      const sure = await this.parent.modal.confirm({
        message: `Discard the changes to ${this.nameOf(path)} and read it again?`,
        confirmLabel: 'Discard and Reload',
      });
      if (!sure) {
        return;
      }
    }
    await this.begin(path);
  }

  /**
   * Asked before a tab is closed (`UiPanelContentDriver.canClose`): the last
   * tab showing a file with unsaved changes asks whether to save them. A file
   * no tab shows any more stops being edited.
   */
  canClose(tabId: string, path: string): boolean | Promise<boolean> {
    if (!this.isEditing(path)) {
      return true;
    }
    const elsewhere = this.parent.editorGroupsFt.states().some((group) => group.tabs.some((tab) => tab.id !== tabId && tab.kind === 'file' && tab.path === path));
    if (elsewhere) {
      return true;
    }
    if (!this.isDirty(path)) {
      this.drop(path);
      return true;
    }
    return this.settle([path]);
  }

  /**
   * Before the window goes (*Quit*, its close button): `true` at once when
   * nothing is unsaved, else once the unsaved files were saved or let go.
   */
  whenSaved(): boolean | Promise<boolean> {
    const dirty = [...this.sessions().keys()].filter((path) => this.isDirty(path));
    return dirty.length === 0 ? true : this.settle(dirty);
  }

  /** Back to viewing, asking about unsaved changes first. */
  private async stopEditing(groupId: string, path: string): Promise<void> {
    if (this.isDirty(path) && !(await this.settle([path]))) {
      return;
    }
    this.drop(path);
    this.parent.filePreviewFt.reload(path);
    this.parent.panelFocusFt.focusBody(groupId);
  }

  /** Asks what to do with unsaved `paths`, and does it; `false` to stay. */
  private async settle(paths: readonly string[]): Promise<boolean> {
    const answer = await this.askUnsaved(paths);
    if (answer === 'cancel') {
      return false;
    }
    if (answer === 'discard') {
      for (const path of paths) {
        this.drop(path);
      }
      return true;
    }
    for (const path of paths) {
      if (!(await this.save(path))) {
        return false;
      }
      this.drop(path);
    }
    return true;
  }

  private async askUnsaved(paths: readonly string[]): Promise<UnsavedAnswer> {
    const result = await this.parent.modal.show({
      severity: 'warning',
      message:
        paths.length === 1
          ? `Do you want to save the changes you made to ${this.nameOf(paths[0] as string)}?`
          : `Do you want to save the changes to ${paths.length} files?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: [
        { id: 'save', label: paths.length === 1 ? 'Save' : 'Save All' },
        { id: 'discard', label: "Don't Save" },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    return (result?.buttonId as UnsavedAnswer | undefined) ?? 'cancel';
  }

  /**
   * Reads the file afresh and opens it for editing — what is saved must be
   * what was read, so not the preview's copy, which may be older. `false`
   * when it cannot be edited, after saying why.
   */
  private async begin(path: string): Promise<boolean> {
    let bytes: Uint8Array;
    try {
      const blob = await this.parent.fileSystem.transferFt.download(path, MAX_PREVIEW_BYTES);
      if (blob.size > MAX_PREVIEW_BYTES) {
        throw new FsError(`${this.nameOf(path)} is larger than the editor's ${MAX_PREVIEW_BYTES / 1024 / 1024} MB`, 413, 'PAYLOAD_TOO_LARGE');
      }
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      await this.parent.modal.message({ message: `Could not open ${this.nameOf(path)} for editing.`, detail: FsError.from(error).message, severity: 'error' });
      return false;
    }
    const sniffed = sniffText(bytes);
    if (sniffed.kind === 'binary' || sniffed.encoding !== 'UTF-8') {
      await this.parent.modal.message({
        message: `${this.nameOf(path)} cannot be edited here.`,
        detail: sniffed.kind === 'binary' ? 'It is not a text file.' : `Only UTF-8 text is edited here; it is ${sniffed.encoding}.`,
        severity: 'warning',
      });
      return false;
    }
    const text = sniffed.text.replace(/\r\n?/g, '\n');
    this.patch(path, {
      text,
      saved: text,
      tag: contentTag(bytes),
      eol: sniffed.text.includes('\r\n') ? '\r\n' : '\n',
      bom: bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2],
      language: languageOf(path, text),
      saving: false,
    });
    return true;
  }

  /** Writes the draft; asked first, when the file changed on disk meanwhile. */
  private async write(path: string, session: EditSession, check: boolean): Promise<boolean> {
    const text = session.text;
    const encoded = new TextEncoder().encode(session.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text);
    const bytes = session.bom ? new Uint8Array([...BOM, ...encoded]) : encoded;
    this.patch(path, { ...session, saving: true });
    try {
      await this.parent.fileSystem.editFt.writeFile(path, bytes, check ? session.tag : undefined);
    } catch (error) {
      const failure = FsError.from(error);
      this.patch(path, { ...(this.sessions().get(path) ?? session), saving: false });
      if (failure.code === 'CHANGED') {
        return this.changedOnDisk(path);
      }
      await this.parent.modal.message({ message: `Could not save ${this.nameOf(path)}.`, detail: failure.message, severity: 'error' });
      return false;
    }
    const now = this.sessions().get(path);
    if (now !== undefined) {
      // What was typed while it was being written stays a change.
      this.patch(path, { ...now, saved: text, tag: contentTag(bytes), saving: false });
    }
    void this.parent.fsDataFt.reloadDetails(path);
    return true;
  }

  /** The file is not what was read: overwrite it, or take what is on disk now. */
  private async changedOnDisk(path: string): Promise<boolean> {
    const result = await this.parent.modal.show({
      severity: 'warning',
      message: `${this.nameOf(path)} was changed on disk since it was opened.`,
      detail: 'Overwrite it with your version, or discard your changes and read it again?',
      buttons: [
        { id: 'overwrite', label: 'Overwrite' },
        { id: 'reload', label: 'Discard My Changes' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    const session = this.sessions().get(path);
    if (result?.buttonId === 'overwrite' && session !== undefined) {
      return this.write(path, session, false);
    }
    if (result?.buttonId === 'reload') {
      await this.begin(path);
    }
    return false;
  }

  private drop(path: string): void {
    this.tables.delete(path);
    if (!this.sessions().has(path)) {
      return;
    }
    this.sessions.update((sessions) => {
      const next = new Map(sessions);
      next.delete(path);
      return next;
    });
  }

  private patch(path: string, session: EditSession): void {
    this.sessions.update((sessions) => new Map(sessions).set(path, session));
  }

  private nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }
}
