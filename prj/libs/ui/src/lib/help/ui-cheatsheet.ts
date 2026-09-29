import { Component, input } from '@angular/core';
import type { UiCheatsheetSection } from '../models/help.model';

/**
 * A cheatsheet of keys (PRD 001, §16.1), the way vim's and tmux's are printed:
 * a card per subject, each in its own colour, a row per thing to do with the
 * keys for it drawn as keycaps. Cards flow into as many columns as fit.
 *
 * Presentational: the application decides what the sections are — here, the
 * key table as the user has it, so what is shown is always what works — and
 * hands them over already filtered. `empty` is said when there are none.
 */
@Component({
  selector: 'ui-cheatsheet',
  templateUrl: './ui-cheatsheet.html',
  styleUrl: './ui-cheatsheet.scss',
})
export class UiCheatsheet {
  readonly sections = input.required<readonly UiCheatsheetSection[]>();

  /** What to say when there are no sections, e.g. nothing matches a search. */
  readonly empty = input<string>('No shortcuts.');
}
