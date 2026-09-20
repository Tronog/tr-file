import { Component, input, output } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiBreadcrumb } from '../models';

/**
 * The path bar above a panel body.
 *
 * Renders an ordered list of crumbs, each a button that emits its id; the
 * chevron between two crumbs is decorative and hidden from assistive tech, so
 * the path reads as a plain sequence of links.
 */
@Component({
  selector: 'ui-breadcrumbs',
  imports: [UiIcon],
  templateUrl: './ui-breadcrumbs.html',
  styleUrl: './ui-breadcrumbs.scss',
})
export class UiBreadcrumbs {
  readonly items = input.required<readonly UiBreadcrumb[]>();

  /** Accessible name of the navigation landmark. */
  readonly label = input<string>('Path');

  readonly select = output<string>();
}
