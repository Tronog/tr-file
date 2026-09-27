/**
 * What a place is (PRD 003, §6) — which icon it gets, and where the Places
 * pane groups it: the root, the user's own folders, then drives and mounts.
 */
export type PlaceKind =
  | 'root'
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'videos'
  | 'drive'
  | 'removable'
  | 'network';

/** A place as the host names it: an absolute path, not yet proven inside the root. */
export interface SystemPlace {
  readonly id: string;
  readonly label: string;
  readonly kind: PlaceKind;
  readonly absolute: string;
}

/**
 * Where the host keeps what a file manager lists in its sidebar — the home
 * folder, Desktop, Downloads, drives and mounts. The desktop shell hands in
 * the system's; a server has none (`NO_PLACES`), and lists only its root.
 */
export interface PlacesProvider {
  /** What the root is called: "File System", "This PC" — the server says "Files". */
  readonly rootLabel: string;
  /** The folder a session starts in, absolute; `null` starts at the root. */
  home(): string | null;
  /** Looked up on every request, so a USB stick plugged in since is there. */
  places(): Promise<readonly SystemPlace[]>;
}

/** A server's places: the root and nothing else, since its host paths are nobody's business. */
export const NO_PLACES: PlacesProvider = {
  rootLabel: 'Files',
  home: () => null,
  places: async () => [],
};

/** One place, as `GET /api/fs/places` answers it: a root-relative path. */
export interface PlaceDto {
  readonly id: string;
  readonly label: string;
  readonly kind: PlaceKind;
  readonly path: string;
}

/** `GET /api/fs/places`: where to start, and what to list in the Places pane. */
export interface PlacesDto {
  /** Root-relative folder a session starts in; `''` is the root. */
  readonly home: string;
  readonly places: readonly PlaceDto[];
}
