import { Component, computed, input } from '@angular/core';
import type { UiDocumentModel } from '../models';

/**
 * A file shown read-only in an editor group, in place of a directory listing
 * (PRD 001, Section 7.3: double-clicking a file opens a preview tab).
 *
 * Presentational like everything else here: it parses nothing and fetches
 * nothing. A `markdown` document arrives as finished HTML — the application
 * renders and sanitises the markdown — and a `text` document arrives as the
 * raw file text, which is printed verbatim in a monospace block.
 *
 * Nothing in the view is editable and nothing but the scroll container takes
 * focus, so the "read-only" promise made by the status line holds literally.
 */
@Component({
  selector: 'ui-document-view',
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

  /**
   * The markdown body. Bound through `[innerHTML]`, which Angular's default
   * sanitiser scrubs on the way in — this component never reaches for
   * `DomSanitizer.bypassSecurityTrustHtml`. The markup itself is produced by
   * the application, not here; the library owns only its typography.
   */
  protected readonly html = computed(() => this.document().html ?? '');

  protected readonly text = computed(() => this.document().text ?? '');
}
