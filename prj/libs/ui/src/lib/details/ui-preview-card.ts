import { Component, input } from '@angular/core';
import { UiIcon } from '../icon/ui-icon';
import { UiImageView } from '../image-view/ui-image-view';
import type { UiPreview } from '../models';

/**
 * The thumbnail card at the top of the details side bar.
 *
 * An entry that has a picture of its own shows it instead of its type icon
 * (PRD 001, §9), fitted whole inside the 96px square. It is a picture and not
 * a control, so the viewer is handed `interactive: false`: no zoom buttons, no
 * gestures, no tab stop — the panel's viewer is where an image is *operated*.
 */
@Component({
  selector: 'ui-preview-card',
  templateUrl: './ui-preview-card.html',
  styleUrl: './ui-preview-card.scss',
  imports: [UiIcon, UiImageView],
  host: { class: 'ui-preview-card' },
})
export class UiPreviewCard {
  /** Name, kind/size line and the file-type icon of the selected entry. */
  readonly preview = input.required<UiPreview>();
}
