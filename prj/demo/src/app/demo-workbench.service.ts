import { Service } from '@angular/core';
import { UiWorkbenchService } from '@tr-file/ui';
import { DemoCommandsFeature } from './demo-commands.feature';
import type { NoteGroup, NoteTab } from './notes.model';
import { NotesFeature } from './notes.feature';

/**
 * The demo's workbench: the library's `UiWorkbenchService` with one feature
 * of its own — the notes — and a command table that offers them.
 */
@Service({ autoProvided: false })
export class DemoWorkbenchService extends UiWorkbenchService<NoteTab, NoteGroup> {
  declare readonly commandsFt: DemoCommandsFeature;

  protected override createCommands(): DemoCommandsFeature {
    return new DemoCommandsFeature(this);
  }

  readonly notesFt = new NotesFeature(this);
}
