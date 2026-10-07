import type { UiSyntaxLanguage } from '../code-editor/syntax/syntax.model';
import type { UiDelimitedText } from '../sheet/delimited-text';
import type { UiIconAction, UiIconName, UiIconTint } from './icon.model';

/** A tab in an editor group's tab bar. */
export interface UiTab {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  readonly active?: boolean;
  /** Preview (single-click) tab — rendered in italics, as in VS Code. */
  readonly preview?: boolean;
  /** Unsaved changes — the close button becomes a dot. */
  readonly dirty?: boolean;
  readonly pinned?: boolean;
}

/** One line of a diff, by what it is: added, removed, unchanged, a hunk header, or git's own header. */
export interface UiDiffLine {
  readonly kind: 'add' | 'remove' | 'context' | 'hunk' | 'meta';
  readonly text: string;
}

/**
 * A file open for editing (PRD 005, §4): `UiCodeEditor` draws it in place of
 * the viewer. The text is the application's draft; the editor reports every
 * change, and is handed the text back.
 */
export interface UiDocumentEditModel {
  readonly text: string;
  readonly language: UiSyntaxLanguage;
  /** The language as the status line names it, e.g. `'Markdown'`. */
  readonly languageLabel: string;
  /** What the status line says of the draft: `'Modified'`, `'Saving…'`. */
  readonly state?: string;
  /** A line to mark, and why — a JSON syntax error (§5). */
  readonly problem?: { readonly line: number; readonly message: string };
}

/** A file rendered in a panel, instead of a directory listing — read-only unless `edit`. */
export interface UiDocumentModel {
  /** Path shown in the viewer's status line, e.g. `docs/prd/001.md`. */
  readonly path: string;
  /**
   * `markdown` renders `html`, `text` renders `text`, `image` renders `src`,
   * `diff` renders `lines`, coloured by kind (PRD 011, §1), `json` renders
   * `json` as a tree (PRD 005, §5), and `table` renders `table` as a
   * spreadsheet (PRD 015, §1) — editable while `edit` is set, its changes
   * reported as the text of the file.
   */
  readonly kind: 'markdown' | 'text' | 'image' | 'diff' | 'json' | 'table';
  /** The cells of a delimited file. Only for `kind: 'table'`. */
  readonly table?: UiDelimitedText;
  /** The parsed document. Only for `kind: 'json'`. */
  readonly json?: unknown;
  /** A `json` document's keys and values may be edited in its tree (PRD 005, §5.2). */
  readonly editable?: boolean;
  /** The file open for editing (PRD 005, §4), drawn instead of whatever `kind` says — but a `table`, which is edited as one. */
  readonly edit?: UiDocumentEditModel;
  /** Sanitised HTML, already rendered by the app. Only for `kind: 'markdown'`. */
  readonly html?: string;
  /** Raw file text. For `kind: 'text'`, and kept with a `json` document for its text view. */
  readonly text?: string;
  /** A unified diff, split into lines by the application. Only for `kind: 'diff'`. */
  readonly lines?: readonly UiDiffLine[];
  /**
   * Where the image bytes are, as a URL the browser can load — in practice an
   * object URL the application made and owns. Only for `kind: 'image'`; the
   * library never fetches it and never revokes it.
   */
  readonly src?: string;
  /** Right-hand status hint, e.g. `'2.4 KB · UTF-8'`. */
  readonly meta?: string;
}

/**
 * The shell of one editor group: its tab bar and the frame around a body.
 * Named `…Model` because `UiPanelGroup` is the component that renders it.
 *
 * What the body shows is not part of it. Each kind of panel content is its
 * own component with its own model — `UiFileBrowser` and `UiFileBrowserModel`
 * for file management — projected into the group by the application.
 */
export interface UiPanelGroupModel {
  readonly id: string;
  readonly tabs: readonly UiTab[];
  readonly actions: readonly UiIconAction[];
  /** Rendered instead of any content when the group holds no tabs. */
  readonly empty?: UiEmptyStateModel;
  /**
   * The active tab's content is being fetched — an indeterminate 2px bar
   * appears under the tab bar. The rail is reserved either way, so it never
   * shifts.
   */
  readonly loading?: boolean;
}

/** Placeholder shown where a panel has nothing to show. */
export interface UiEmptyStateModel {
  readonly icon: UiIconName;
  readonly title: string;
  readonly hint?: string;
  readonly keys?: readonly string[];
}

/** A leaf of the editor grid: one group occupying its slot. */
export interface UiGridLeaf {
  readonly kind: 'leaf';
  readonly groupId: string;
  /** `flex-grow` share within its parent split. */
  readonly size?: number;
}

/** A split of the editor grid: children laid out along one axis. */
export interface UiGridSplit {
  readonly kind: 'split';
  /** `'row'` = side by side (vertical sashes), `'column'` = stacked. */
  readonly direction: 'row' | 'column';
  readonly children: readonly UiGridNode[];
  readonly size?: number;
}

/**
 * The recursive editor layout. Splitting, grouping and moving panels are all
 * transformations of this tree — which is why the grid is modelled as data
 * rather than as markup.
 */
export type UiGridNode = UiGridLeaf | UiGridSplit;

/** A tab of the bottom panel (Problems / Output / Terminal / Transfers). */
export interface UiPanelTab {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  readonly active?: boolean;
}

