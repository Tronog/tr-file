/**
 * What a command acts on. The library's commands need the panel group only —
 * and a tab, for the tab's own commands; an application's target adds what
 * its commands act on (tr-file: the entries selected, the folder listed).
 */
export interface UiCommandTarget {
  /** The panel it concerns — from a menu, a key or the palette, the active one. */
  readonly groupId: string;
  /** A tab, for the commands about tabs. */
  readonly tabId?: string;
}

/**
 * A function of what a command acts on. Written as a method's type, so it is
 * compared bivariantly: a table of an application's commands — over its own,
 * richer target — is still a table of the library's.
 */
export type UiTargetFn<T, R> = { fn(target: T): R }['fn'];

/**
 * One command of the workbench (PRD 003, §4–5): the main menu, the context
 * menus, the palette and the keys all name commands by id, so each is
 * written once, enabled by one rule, and runs the same whichever way it is
 * reached.
 */
export interface UiCommand<T extends UiCommandTarget = UiCommandTarget> {
  readonly id: string;
  /** Before the label in the palette, as in VS Code: `View: Toggle Panel`. */
  readonly category: string;
  readonly label: UiTargetFn<T, string>;
  /** Whether the palette lists it; commands of a context menu only do not. */
  readonly palette: boolean;
  readonly enabled: UiTargetFn<T, boolean>;
  /** For a choice among several, or a switch: whether it is the one in effect. */
  readonly checked?: UiTargetFn<T, boolean>;
  readonly run: UiTargetFn<T, void | Promise<void>>;
}

/** A command as it is written: a plain label, and `palette` and `enabled` left out where they are the default. */
export type UiCommandSpec<T extends UiCommandTarget = UiCommandTarget> = Omit<UiCommand<T>, 'label' | 'palette' | 'enabled'> & {
  readonly label: string | UiTargetFn<T, string>;
  /** Listed in the palette unless `false`. */
  readonly palette?: boolean;
  /** Always enabled unless given. */
  readonly enabled?: UiTargetFn<T, boolean>;
};
