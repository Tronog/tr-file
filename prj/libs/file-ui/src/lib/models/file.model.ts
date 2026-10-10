import type { UiBreadcrumb, UiDocumentModel, UiEmptyStateModel, UiGitDecoration, UiIconAction, UiIconName, UiIconTint, UiPathSuggestion, UiSelectionModeId } from '@tr-file/ui';

/*
 * The file manager's view models: what a listing, its rows and tiles, the
 * file browser around them and the transfers panel are drawn from — and the
 * vocabulary of keys and drops a listing reports.
 */

/** A column header in the list view. */
export interface UiFileColumn {
  readonly key: string;
  readonly label: string;
  /** Any CSS width, e.g. `'90px'`. Omit for the flexible name column. */
  readonly width?: string;
  readonly align?: 'start' | 'end';
  readonly sort?: 'asc' | 'desc';
}

/** A row in the list view. `cells` is keyed by `UiFileColumn.key`. */
export interface UiFileRow {
  readonly id: string;
  readonly name: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  readonly cells: Readonly<Record<string, string>>;
  readonly decoration?: UiGitDecoration;
  readonly selected?: boolean;
  readonly focused?: boolean;
  /** Selected, but the owning group is not focused (dimmed selection). */
  readonly inactiveSelected?: boolean;
  /**
   * Nesting level below the listed folder, 0 based — only read when the list
   * renders as a tree (`UiFileList.tree`). Drives indentation and `aria-level`.
   */
  readonly depth?: number;
  /** A directory in a tree: the row gets a twisty. */
  readonly expandable?: boolean;
  /** An expandable row showing its children. */
  readonly expanded?: boolean;
  /** An expanded row whose contents are being fetched — the twisty spins. */
  readonly busy?: boolean;
  /** A folder: dragged entries may be dropped onto it (PRD 005, §2). */
  readonly dropTarget?: boolean;
  /** On the clipboard to be moved: drawn faded, as file managers do. */
  readonly cut?: boolean;
}

/** A tile in the grid ("large icons") view. */
export interface UiIconViewItem {
  readonly id: string;
  readonly label: string;
  readonly icon: UiIconName;
  readonly tint?: UiIconTint;
  readonly selected?: boolean;
  /** The one tile that owns keyboard focus; drives the roving tabindex. */
  readonly focused?: boolean;
  /** A folder: dragged entries may be dropped onto it (PRD 005, §2). */
  readonly dropTarget?: boolean;
  /** On the clipboard to be moved: drawn faded. */
  readonly cut?: boolean;
  /**
   * A picture of the file, drawn in place of the icon (PRD 003, §6) — any
   * URL an `<img>` takes; the application makes and frees it.
   */
  readonly thumbnail?: string;
}

/**
 * How a group renders its directory contents: a details table, large icons, or
 * the details table as a tree whose folders open in place.
 */
export type UiPanelView = 'list' | 'grid' | 'tree';

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
  /** What the filter box holds (PRD 003, §5); the listing is already filtered by it. */
  readonly filterText?: string;
  /**
   * The folder as a path someone can type — `/docs/prd` — shown when the path
   * bar is edited (PRD 003, §5). Omit it and the path bar cannot be edited.
   */
  readonly location?: string;
  /** Places the path bar suggests for what is typed in it (PRD 004, §4.2); see `UiFileBrowser.locationInput`. */
  readonly locationSuggestions?: readonly UiPathSuggestion[];
  /**
   * Something is being read that `Escape` stops — a large folder (PRD 004,
   * §3.1.4). While it is not, `Escape` is left alone.
   */
  readonly stoppable?: boolean;
  /** The listing can be sorted by clicking its column headers. */
  readonly sortable?: boolean;
  /** How the listing selects (PRD 004, §2.2); `normal` when absent. */
  readonly selectionMode?: UiSelectionModeId;
  /**
   * Bump to put the keyboard in the filter box — a menu's *Filter Folder*,
   * where `Ctrl`+`F` in the panel does it itself. Any change is one request.
   */
  readonly filterFocus?: number;
  /** Bump to turn the path bar into a text field, as `Ctrl`+`L` does. */
  readonly locationEdit?: number;
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
  /**
   * The listed folder takes entries dropped on the listing's blank space —
   * and its empty state (PRD 005, §2). Folders in it say so per row.
   */
  readonly dropFolder?: boolean;
  /**
   * The content is on its way — a file being read. The body stays empty
   * rather than drawing an empty listing where the document will appear.
   */
  readonly pending?: boolean;
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
  /** Shown as the row's tooltip — what it is working on, or why it failed. */
  readonly detail?: string;
  /** Gives the row a stop button, which `UiTransferList` reports as `cancel`. */
  readonly cancellable?: boolean;
}

/**
 * MIME type carrying dragged entries of a `UiFileBrowser` — within a panel or
 * to another (PRD 005, §2). The payload is `{ "sources": string[] }`.
 */
export const UI_ENTRY_MIME = 'application/x-tr-file-entries';

/**
 * Entries dropped on a `UiFileBrowser` (PRD 005, §2): onto a folder in it
 * (`target`), or onto the listing's blank space (`target: null`, the folder
 * it lists). `copy` when `Ctrl` (or `Alt`) was held — a move otherwise, as in
 * VS Code's explorer. What happens is the application's business.
 */
export interface UiEntryDrop {
  readonly sources: readonly string[];
  readonly target: string | null;
  readonly copy: boolean;
}

/**
 * A key pressed inside a panel body whose meaning belongs to the application.
 *
 * Moving focus stays with the component: it is DOM work, and a roving
 * tabindex can only be rolled where the elements are. Everything that changes
 * what the workbench *shows* leaves as one of these instead, so a panel's key
 * bindings are decided in one place rather than spread across a template.
 */
export type UiPanelCommand =
  | 'open'
  | 'open-aside'
  | 'select'
  | 'up'
  | 'refresh'
  | 'back'
  | 'forward'
  | 'delete'
  | 'delete-permanently'
  | 'new-folder'
  | 'undo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'copy-path'
  | 'select-pattern'
  | 'unselect-pattern'
  | 'previous-image'
  | 'next-image'
  | 'close'
  | 'stop-loading'
  | 'additive-selection'
  | 'normal-selection';

/**
 * One `UiPanelCommand`, with the entry focus sat on when the key was hit.
 *
 * `back` and `forward` carry an entry like the rest, but never use one: they
 * are about where the *panel* has been, not what is selected in it.
 * `open-aside` (`Ctrl`+`Enter`, `Ctrl`+double click) opens its entry in the
 * other panel (PRD 002, §2.5).
 * `copy-path` is `Ctrl`+`Shift`+`C` (PRD 004, §1.3.2): its entry, or — with
 * none — whatever the panel shows.
 * `select-pattern` / `unselect-pattern` are `+` / `-` (PRD 004, §2): the
 * application asks for the pattern.
 * `close` is `Escape` over a file (PRD 005, §3.1; PRD 012, §1.3): the tab showing it closes.
 * `additive-selection` is `Insert` in normal selection mode, which marks its entry and asks for
 * additive mode; `normal-selection` is `Escape` over a listing: back to normal, nothing selected
 * (PRD 004, §2.2). The panel keeps the mode and hands it back as `UiFileBrowserModel.selectionMode`.
 *
 * The function keys are not panel keys: `F1`–`F10` mean the same wherever
 * focus is (PRD 004, §2), so the application binds them for the whole window.
 */
export interface UiPanelKey {
  readonly command: UiPanelCommand;
  /** `null` when the body lists nothing — `up` and `refresh` still apply. */
  readonly entryId: string | null;
}

/** read/write/execute for one principal. */
export interface UiPermissionTriplet {
  readonly read: boolean;
  readonly write: boolean;
  readonly execute: boolean;
}

/** The full POSIX permission matrix plus its octal rendering. */
export interface UiPermissions {
  readonly owner: UiPermissionTriplet;
  readonly group: UiPermissionTriplet;
  readonly others: UiPermissionTriplet;
  /** e.g. `'0644'`. */
  readonly mode: string;
}
