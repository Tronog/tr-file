import type { UiGroupState, UiTabState } from '@tr-file/ui';

/** A note: what the demo keeps. */
export interface Note {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** A panel tab: a note open for editing, or the welcome page. */
export interface NoteTab extends UiTabState {
  readonly kind: 'note' | 'welcome';
  /** The note a `note` tab shows. */
  readonly noteId?: string;
}

/** A panel group: its tabs, nothing more — the demo's groups keep nothing of their own. */
export type NoteGroup = UiGroupState<NoteTab>;
