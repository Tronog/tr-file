import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { UiTreeNode } from '@tr-file/ui';
import type { DemoWorkbenchService } from './demo-workbench.service';
import type { Note } from './notes.model';

/** Where the notes are kept, beside the workbench's own settings. */
const NOTES_KEY = 'ui-demo.notes.v1';

const FIRST: readonly Note[] = [
  { id: 'note-1', title: 'Shopping', text: '# Shopping\n\n- bread\n- milk\n\n## Later\n\n- a lamp' },
  { id: 'note-2', title: 'Ideas', text: '# Ideas\n\nA workbench that is a library.\n\n## Next\n\nAnother app on it.' },
];

/**
 * The notes: kept in the workbench's settings store, listed in the Explorer,
 * opened in panel tabs. The demo's one feature of its own — everything else
 * is the library's.
 */
export class NotesFeature {
  private readonly notes: WritableSignal<readonly Note[]>;
  private seq: number;

  /** What happened, newest last — the bottom panel's Output. */
  readonly log = signal<readonly string[]>(['Workbench started.']);

  readonly all: Signal<readonly Note[]>;

  constructor(private readonly parent: DemoWorkbenchService) {
    this.notes = signal(this.load());
    this.all = this.notes.asReadonly();
    this.seq = Math.max(0, ...this.notes().map((note) => Number(note.id.replace('note-', '')) || 0));
  }

  readonly tree = computed<readonly UiTreeNode[]>(() =>
    this.notes().map((note) => ({ id: note.id, label: note.title, depth: 0, icon: 'file-text', expandable: false, guides: [], selected: note.id === this.activeNoteId() })),
  );

  /** The note the active panel shows, if it shows one. */
  readonly activeNoteId = computed(() => {
    const groups = this.parent.editorGroupsFt;
    const group = groups.stateOf(this.parent.activeGroupId());
    const tab = group === undefined ? undefined : groups.activeTabOf(group);
    return tab?.kind === 'note' ? (tab.noteId ?? null) : null;
  });

  readonly active = computed(() => this.notes().find((note) => note.id === this.activeNoteId()) ?? null);

  /** The active note's headings — the Outline pane. */
  readonly outline = computed<readonly UiTreeNode[]>(() =>
    (this.active()?.text ?? '')
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.startsWith('#'))
      .map(({ line, index }) => {
        const depth = (/^#+/.exec(line)?.[0].length ?? 1) - 1;
        return { id: `line-${index}`, label: line.replace(/^#+\s*/, ''), depth, icon: 'list' as const, expandable: false, guides: Array.from({ length: depth }, () => true) };
      }),
  );

  find(id: string): Note | undefined {
    return this.notes().find((note) => note.id === id);
  }

  /** Opens a note in the active panel — the tab it has there already, or a new one. */
  open(id: string): void {
    const note = this.find(id);
    const groups = this.parent.editorGroupsFt;
    const groupId = this.parent.activeGroupId();
    const existing = groups.stateOf(groupId)?.tabs.find((tab) => tab.noteId === id);
    if (note === undefined) {
      return;
    }
    if (existing !== undefined) {
      groups.selectTab(groupId, existing.id);
    } else {
      groups.openTab(groupId, { kind: 'note', label: note.title, noteId: id });
    }
    this.parent.panelFocusFt.focusBody(groupId);
  }

  create(): void {
    this.seq += 1;
    const note: Note = { id: `note-${this.seq}`, title: `Note ${this.seq}`, text: `# Note ${this.seq}\n\n` };
    this.save([...this.notes(), note]);
    this.write(`Made ${note.title}.`);
    this.open(note.id);
  }

  edit(id: string, text: string): void {
    const title = /^#\s*(.+)$/m.exec(text)?.[1]?.trim() || this.find(id)?.title || id;
    this.save(this.notes().map((note) => (note.id === id ? { ...note, text, title } : note)));
    // A tab follows its note's title.
    for (const group of this.parent.editorGroupsFt.states()) {
      if (group.tabs.some((tab) => tab.noteId === id && tab.label !== title)) {
        this.parent.editorGroupsFt.update(group.id, (state) => ({ ...state, tabs: state.tabs.map((tab) => (tab.noteId === id ? { ...tab, label: title } : tab)) }));
      }
    }
  }

  async remove(id: string): Promise<void> {
    const note = this.find(id);
    if (note === undefined) {
      return;
    }
    if (this.parent.preferencesFt.value('notes.confirmDelete')) {
      const sure = await this.parent.modal.confirm({ severity: 'warning', message: `Delete '${note.title}'?`, confirmLabel: 'Delete' });
      if (!sure) {
        return;
      }
    }
    for (const group of this.parent.editorGroupsFt.states()) {
      for (const tab of group.tabs.filter((candidate) => candidate.noteId === id)) {
        this.parent.editorGroupsFt.closeTab(group.id, tab.id);
      }
    }
    this.save(this.notes().filter((candidate) => candidate.id !== id));
    this.write(`Deleted ${note.title}.`);
  }

  write(line: string): void {
    this.log.update((log) => [...log, line]);
  }

  private save(notes: readonly Note[]): void {
    this.notes.set(notes);
    this.parent.settings.set(NOTES_KEY, notes);
  }

  private load(): readonly Note[] {
    const stored = this.parent.settings.get<unknown>(NOTES_KEY);
    return Array.isArray(stored) ? (stored as Note[]) : FIRST;
  }
}
