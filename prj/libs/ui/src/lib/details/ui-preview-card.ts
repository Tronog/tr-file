import { Component, input } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import type { UiPreview } from '../models';

/** The thumbnail card at the top of the details side bar. */
@Component({
  selector: 'ui-preview-card',
  templateUrl: './ui-preview-card.html',
  styleUrl: './ui-preview-card.scss',
  imports: [UiIcon],
  host: { class: 'ui-preview-card' },
})
export class UiPreviewCard {
  /** Name, kind/size line and the file-type icon of the selected entry. */
  readonly preview = input.required<UiPreview>();
}
