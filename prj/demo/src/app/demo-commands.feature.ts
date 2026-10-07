import { UiCommandsFeature, type UiCommandSpec } from '@tr-file/ui';
import type { DemoWorkbenchService } from './demo-workbench.service';

/** The demo's command table: its two commands, then the library's. */
export class DemoCommandsFeature extends UiCommandsFeature {
  constructor(protected override readonly parent: DemoWorkbenchService) {
    super(parent);
  }

  protected override define(): readonly UiCommandSpec[] {
    const notes = this.parent.notesFt;
    return [
      { id: 'notes.new', category: 'Notes', label: 'New Note', run: () => notes.create() },
      {
        id: 'notes.delete',
        category: 'Notes',
        label: 'Delete Note…',
        enabled: () => notes.activeNoteId() !== null,
        run: () => notes.remove(notes.activeNoteId() as string),
      },
      ...this.builtins(),
    ];
  }
}
