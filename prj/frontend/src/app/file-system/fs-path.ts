/** A path over every drive of a Windows machine (PRD 003, §6): `C:`, `C:/Users`. */
const DRIVE_PATH = /^[A-Za-z]:(\/|$)/;

/**
 * A root-relative path as the app shows it: from `/` — `/docs/a.md`, `/` for
 * the root — but a drive's as Windows writes it, `C:/Windows`, never
 * `/C:/Windows` (PRD 004, §1.4).
 */
export function shownPath(path: string): string {
  return DRIVE_PATH.test(path) ? path : `/${path}`;
}

/** Whether a typed path is absolute: from `/`, or from a drive (`C:/Windows`, `C:\Windows`). */
export function isAbsoluteShown(text: string): boolean {
  return text.startsWith('/') || DRIVE_PATH.test(text.replace(/\\/g, '/'));
}
