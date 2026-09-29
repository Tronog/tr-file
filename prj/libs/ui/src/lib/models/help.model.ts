/** A page of the Help window (PRD 001, §16). */
export interface UiHelpTab {
  readonly id: string;
  readonly label: string;
}

/** The colour a cheatsheet section wears: its band, and the tint of its keys. */
export type UiCheatsheetHue = 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'yellow' | 'pink' | 'red';

/** One line of a cheatsheet: the keys that do it, and what it does. */
export interface UiCheatsheetRow {
  readonly id: string;
  /**
   * Each alternative is a chord, and a chord its keys as shown — `['Ctrl',
   * 'Shift', 'P']`, `['↑']`. Alternatives are drawn side by side.
   */
  readonly keys: readonly (readonly string[])[];
  readonly label: string;
  /** Where it applies, when that is not the section's own place: `On a row`. */
  readonly where?: string;
}

/** A card of the cheatsheet (PRD 001, §16.1). */
export interface UiCheatsheetSection {
  readonly id: string;
  readonly title: string;
  readonly hue: UiCheatsheetHue;
  /** A line under the title. */
  readonly note?: string;
  readonly rows: readonly UiCheatsheetRow[];
}
