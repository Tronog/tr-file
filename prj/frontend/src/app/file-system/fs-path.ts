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

/**
 * How *Copy Path* writes a path (PRD 004, §1.3.2): as the host spells it, or
 * the UNIX way — `Ctrl`+`Shift`+`C` pressed twice — for a shell that wants `/`.
 */
export type FsPathStyle = 'native' | 'unix';

/**
 * A host path the UNIX way (PRD 004, §1.3.2): the drive as a folder of the
 * root, `C:\Users\me` → `/C/Users/me` and `C:\` → `/C/`, every `\` a `/`.
 * A path that already is one is left as it is.
 */
export function unixPath(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):(\/.*)?$/.exec(slashed);
  return drive === null ? slashed : `/${drive[1] as string}${drive[2] ?? ''}`;
}

/** Whether a typed path is absolute: from `/`, or from a drive (`C:/Windows`, `C:\Windows`). */
export function isAbsoluteShown(text: string): boolean {
  return text.startsWith('/') || DRIVE_PATH.test(text.replace(/\\/g, '/'));
}
