import type { UiEmptyStateModel, UiIconName } from '@tr-file/ui';

/**
 * One column of a `UiProcessList` (PRD 014, §2): Windows 10 Task Manager's
 * header, a number over a name for what is measured — `12%` over `CPU` —
 * and the name alone for the rest.
 */
export interface UiProcessColumn {
  readonly id: string;
  readonly label: string;
  /** The whole machine's, above the label: `12%`, `48%`, `0.1 MB/s`. */
  readonly total?: string;
  /** How loaded the whole machine is, 0–1: the total's cell is shaded by it. */
  readonly totalHeat?: number;
  /** Right-aligned and shaded by load, like Task Manager's numbers. */
  readonly numeric?: boolean;
  /** Its width in pixels; the Name column's least, growing to twice it. */
  readonly width: number;
  /** The order the list is in, when it is this column's. */
  readonly sort?: 'asc' | 'desc';
  /** The header's tooltip. */
  readonly title?: string;
}

/** What one row shows in one column, already formatted. */
export interface UiProcessCell {
  readonly text: string;
  /** How loaded, 0–1: the cell is shaded as Task Manager shades it. */
  readonly heat?: number;
}

/**
 * A row of the list: a heading (`section`: *Apps (4)*), an app or executable
 * with its processes under it (`group`), or one process.
 */
export interface UiProcessRow {
  /** Unique within the list; what selecting, expanding and the menus report. */
  readonly id: string;
  readonly kind: 'section' | 'group' | 'process';
  /** `0` a heading, `1` under it, `2` a process of a group. */
  readonly level: number;
  readonly label: string;
  /** Said after the label, dimmed: how many processes, a window's title. */
  readonly detail?: string;
  readonly icon?: UiIconName;
  readonly expandable?: boolean;
  readonly expanded?: boolean;
  /** By column id; a column with no cell is blank. */
  readonly cells: Readonly<Record<string, UiProcessCell>>;
  /** The tooltip: its path, command line, user. */
  readonly title?: string;
  /** Drawn as a warning: not responding. */
  readonly warning?: boolean;
}

/** Everything a `UiProcessList` draws. */
export interface UiProcessListModel {
  readonly columns: readonly UiProcessColumn[];
  readonly rows: readonly UiProcessRow[];
  readonly selectedId: string | null;
  /** The toolbar's filter box. */
  readonly filter: string;
  /** Updates are paused: the pause button is pressed, and the list stands still. */
  readonly paused: boolean;
  /** Whether *End task* may be pressed for the row selected. */
  readonly canEnd: boolean;
  /** The button's tooltip when it may not: why. */
  readonly endTitle?: string;
  /** Right of the toolbar: `312 processes · paused`. */
  readonly summary?: string;
  /** Shown instead of the list: not measured here, not yet, nothing matches. */
  readonly empty?: UiEmptyStateModel;
}

/** A right-click, or `Shift`+`F10`: on a row (`target` its id) or the header (`target: 'header'`). */
export interface UiProcessMenuRequest {
  readonly target: string;
  readonly x: number;
  readonly y: number;
}
