import { Component, computed, input, output, signal, viewChild, type ElementRef } from '@angular/core';
import { UiCodeEditor } from '../code-editor/ui-code-editor';
import type { UiCodePosition } from '../code-editor/ui-code-editor.service';
import { UiJsonTree } from '../json-tree/ui-json-tree';
import { serializeDelimited, type UiDelimitedText } from '../sheet/delimited-text';
import { UiSheet } from '../sheet/ui-sheet';
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
 * Its text can be selected and copied, though (PRD 005, §3): by the mouse,
 * `Shift` with the arrows as anywhere, and `Ctrl`+`A`, which selects the
 * document alone; `Ctrl`+`C` and the right-click menu are the browser's.
 *
 * A `table` document is a spreadsheet (PRD 015, §1, `UiSheet`), edited in
 * place while it has `edit`. A `json` document is a tree of its values (PRD 005, §5, `UiJsonTree`). A
 * document with `edit` is open for editing (§4): `UiCodeEditor` draws it in
 * place of all of that, every change is reported (`textChange`) for the
 * application to keep, and the status line says where the caret is.
 */
@Component({
  selector: 'ui-document-view',
  imports: [UiImageView, UiCodeEditor, UiJsonTree, UiSheet],
  templateUrl: './ui-document-view.html',
  styleUrl: './ui-document-view.scss',
})
export class UiDocumentView {
  readonly document = input.required<UiDocumentModel>();

  /** The text of a document being edited, after each change. */
  readonly textChange = output<string>();

  /** Where the editor's caret is, for the status line. */
  protected readonly caret = signal<UiCodePosition>({ line: 1, column: 1 });

  /** Where a spreadsheet's selection is: `B4`, `B4:C9`. */
  protected readonly cell = signal('A1');

  /** A spreadsheet's cells changed (PRD 015, §1): reported as the file's text, written as it was read. */
  protected onRows(table: UiDelimitedText, rows: readonly (readonly string[])[]): void {
    this.textChange.emit(serializeDelimited({ ...table, rows }));
  }

  /**
   * Accessible name of the rendered region. The path is what distinguishes one
   * open document from another, so it names the article.
   */
  protected readonly label = computed(() => this.document().path);

  protected readonly isMarkdown = computed(() => this.document().kind === 'markdown');

  protected readonly isImage = computed(() => this.document().kind === 'image');

  protected readonly isJson = computed(() => this.document().kind === 'json');

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

  private readonly docRef = viewChild<ElementRef<HTMLElement>>('doc');

  /**
   * `Ctrl`+`A` selects the document's text and nothing else — left to the
   * browser it would take every bit of selectable text in the window. A text
   * field's own key, so fixed rather than a keymap command (PRD 010, §2).
   */
  protected onKeydown(event: KeyboardEvent): void {
    const doc = this.docRef()?.nativeElement;
    if (doc === undefined || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'a') {
      return;
    }
    const selection = doc.ownerDocument.getSelection();
    if (selection === null) {
      return;
    }
    selection.selectAllChildren(doc);
    event.preventDefault();
  }
}
