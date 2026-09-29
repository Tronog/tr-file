import { Component, input, output } from '@angular/core';
import type { UiProperty, UiPropertyActivation } from '../models';

/**
 * The label/value table of the details side bar.
 *
 * A `<dl>` with a fixed 96px label column; `mono` switches the value to the
 * monospace face and `tone` tints it with the matching git decoration colour.
 * A value with an `action` is a button, reported by `action` when pressed —
 * with whether `Shift` was held, which for a path to copy means the UNIX way
 * (PRD 001, §9.3.1). A `copy` value keeps the value's own look; a `badge`
 * follows it for a moment, `Copied`.
 */
@Component({
  selector: 'ui-property-list',
  templateUrl: './ui-property-list.html',
  styleUrl: './ui-property-list.scss',
  host: { class: 'ui-property-list' },
})
export class UiPropertyList {
  readonly properties = input.required<readonly UiProperty[]>();

  /** The `action` of a value that was pressed, and whether `Shift` was held. */
  readonly action = output<UiPropertyActivation>();
}
