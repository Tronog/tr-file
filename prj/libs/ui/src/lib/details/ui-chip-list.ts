import { Component, input } from '@angular/core';
import type { UiChip } from '../models';

/** The tag chips of the details side bar. Display only — chips are not removable. */
@Component({
  selector: 'ui-chip-list',
  templateUrl: './ui-chip-list.html',
  styleUrl: './ui-chip-list.scss',
  host: { class: 'ui-chip-list' },
})
export class UiChipList {
  readonly chips = input.required<readonly UiChip[]>();
}
