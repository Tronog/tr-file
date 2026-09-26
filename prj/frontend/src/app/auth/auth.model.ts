/**
 * Whether this backend asks anyone to sign in, and whether this session has
 * (PRD 003, §2). Mirrors the backend's `AuthStatusDto`.
 */
export interface AuthStatus {
  readonly required: boolean;
  readonly authenticated: boolean;
  readonly username: string | null;
}
