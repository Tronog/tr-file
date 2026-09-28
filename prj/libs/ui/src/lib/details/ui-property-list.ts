import { Component, input, output } from '@angular/core';
import type { UiProperty } from '../models';

/**
 * The label/value table of the details side bar.
 *
 * A `<dl>` with a fixed 96px label column; `mono` switches the value to the
 * monospace face and `tone` tints it with the matching git decoration colour.
 * A value with an `action` is a button, reported by `action` when pressed.
 */
@Component({
  selector: 'ui-property-list',
  templateUrl: './ui-property-list.html',
  styleUrl: './ui-property-list.scss',
  host: { class: 'ui-property-list' },
})
export class UiPropertyList {
  readonly properties = input.required<readonly UiProperty[]>();

  /** The `action` of a value that was pressed. */
  readonly action = output<string>();
}
