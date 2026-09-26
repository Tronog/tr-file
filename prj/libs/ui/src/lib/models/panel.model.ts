import type { UiBreadcrumb, UiFileColumn, UiFileRow, UiIconViewItem } from './file.model';
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

/** A file rendered read-only in a panel, instead of a directory listing. */
export interface UiDocumentModel {
  /** Path shown in the viewer's status line, e.g. `docs/prd/001.md`. */
  readonly path: string;
  /** `markdown` renders `html`, `text` renders `text`, `image` renders `src`. */
  readonly kind: 'markdown' | 'text' | 'image';
  /** Sanitised HTML, already rendered by the app. Only for `kind: 'markdown'`. */
  readonly html?: string;
  /** Raw file text. Only for `kind: 'text'`. */
  readonly text?: string;
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
 * How a group renders its directory contents: a details table, large icons, or
 * the details table as a tree whose folders open in place.
 */
export type UiPanelView = 'list' | 'grid' | 'tree';

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

/**
 * The file-management content of a panel: a path bar, a toolbar and either a
 * listing or one file rendered read-only. Rendered by `UiFileBrowser`.
 */
export interface UiFileBrowserModel {
  readonly breadcrumbs: readonly UiBreadcrumb[];
  readonly view: UiPanelView;
  /** Leading icon buttons of the toolbar (up, refresh, sort, filter…). */
  readonly toolbarActions: readonly UiIconAction[];
  /** Whether the toolbar offers the list/grid switch. */
  readonly showViewSwitch?: boolean;
  /** Placeholder of the toolbar filter box; omit to hide the box. */
  readonly searchPlaceholder?: string;
  readonly columns: readonly UiFileColumn[];
  readonly rows: readonly UiFileRow[];
  readonly items: readonly UiIconViewItem[];
  /** Shown on the right of the toolbar, e.g. `'6 items'`. */
  readonly summary?: string;
  /**
   * Rendered instead of a listing: an empty folder, a folder that could not
   * be read, a file that cannot be shown.
   */
  readonly empty?: UiEmptyStateModel;
  /**
   * A file open read-only: rendered instead of a listing when the tab is a
   * file. `empty` still wins, since that is how a file that cannot be shown
   * explains itself.
   */
  readonly document?: UiDocumentModel;
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

/** A row of the Transfers panel. */
export interface UiTransfer {
  readonly id: string;
  readonly name: string;
  readonly icon: UiIconName;
  /** Any CSS colour; use a token such as `var(--vsc-git-untracked)`. */
  readonly iconColor?: string;
  /** 0–100, or `null` for an indeterminate (queued) transfer. */
  readonly progress: number | null;
  readonly statusLabel: string;
}
