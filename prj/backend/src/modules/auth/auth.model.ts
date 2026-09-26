/** What `GET /api/auth/session` and the bridge's `auth-status` answer. */
export interface AuthStatusDto {
  /** Whether this server asks anyone to sign in at all. */
  readonly required: boolean;
  /** Whether the caller may use the file system right now. */
  readonly authenticated: boolean;
  /** Who is signed in, or `null`. */
  readonly username: string | null;
}
