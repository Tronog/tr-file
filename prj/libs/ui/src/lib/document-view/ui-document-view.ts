import { Component, computed, input } from '@angular/core';
import { UiImageView } from '../image-view/ui-image-view';
import type { UiDocumentModel } from '../models';

/**
 * A file shown read-only in an editor group, in place of a directory listing
 * (PRD 001, Section 7.3: double-clicking a file opens a preview tab).
 *
 * Presentational like everything else here: it parses nothing and fetches
 * nothing. A `markdown` document arrives as finished HTML — the application
 * renders and sanitises the markdown — a `text` document arrives as the raw
 * file text, printed verbatim in a monospace block, and an `image` document
 * arrives as a URL the application made and owns, handed to `UiImageView`
 * (PRD 001, §7.3.1).
 *
 * Nothing in the view is editable and nothing but the scroll container takes
 * focus, so the "read-only" promise made by the status line holds literally.
 */
@Component({
  selector: 'ui-document-view',
  imports: [UiImageView],
  templateUrl: './ui-document-view.html',
  styleUrl: './ui-document-view.scss',
})
export class UiDocumentView {
  readonly document = input.required<UiDocumentModel>();

  /**
   * Accessible name of the rendered region. The path is what distinguishes one
   * open document from another, so it names the article.
   */
  protected readonly label = computed(() => this.document().path);

  protected readonly isMarkdown = computed(() => this.document().kind === 'markdown');

  protected readonly isImage = computed(() => this.document().kind === 'image');

  /** Where the image bytes are; `''` for anything that is not an image. */
  protected readonly src = computed(() => this.document().src ?? '');

  /**
   * The markdown body. Bound through `[innerHTML]`, which Angular's default
   * sanitiser scrubs on the way in — this component never reaches for
   * `DomSanitizer.bypassSecurityTrustHtml`. The markup itself is produced by
   * the application, not here; the library owns only its typography.
   */
  protected readonly html = computed(() => this.document().html ?? '');

  protected readonly text = computed(() => this.document().text ?? '');

  protected readonly isDiff = computed(() => this.document().kind === 'diff');

  protected readonly lines = computed(() => this.document().lines ?? []);
}
