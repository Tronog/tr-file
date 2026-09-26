# @tr-file/backend

Express 5 + TypeScript API for the file manager. Composition root in
`src/app.ts`; every feature lives in `src/modules/<name>/` split into routes,
services and models, per `docs/ai/EXPRESS.md`.

## Running it

```bash
pnpm dev        # tsx watch, http://localhost:4310
pnpm build      # tsc → dist/ (runtime only; tests are excluded)
pnpm start      # node dist/main.js
pnpm test       # node:test via tsx, straight from src/
pnpm typecheck  # runtime sources + test sources
pnpm hash-password  # reads a password on stdin, prints an AUTH_PASSWORD_HASH
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `4310` | Listen address |
| `API_PREFIX` | `/api` | Mount prefix for every module |
| `FILES_ROOT` | `process.cwd()` | Absolute path all file access is confined to |
| `UPLOAD_MAX_BYTES` | `536870912` (512 MiB) | Per-upload limit |
| `LOG_LEVEL` | `debug` / `info` in production | Log verbosity |
| `NODE_ENV` | `development` | Environment |
| `AUTH_USERNAME` | unset | The one account allowed to sign in |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_HASH` | unset | Its password, plain or as made by `pnpm hash-password` (preferred) |
| `AUTH_ENABLED` | see below | `false` runs with no login; `true` refuses to start without an account |
| `AUTH_SESSION_IDLE_HOURS` | `12` | A session unused this long is signed out |

## Signing in and CSRF (PRD 003, §2)

**Signing in is on unless switched off.** With an account configured, every
`/api` route but `/api/auth/*` and `/api/health` answers `401 UNAUTHORIZED`
without a session. A production server with no account **refuses to start**;
only `AUTH_ENABLED=false` (the desktop shell's default) or a development
server with nothing configured runs open, and says so in its log.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/session` | `{ required, authenticated, username }` — always answered |
| POST | `/api/auth/login` | JSON `{ username, password }`; sets the session cookie |
| POST | `/api/auth/logout` | Ends the session and clears the cookie |

The session is a random 256-bit token in a `tr_file_session` cookie —
`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS, and gone when the browser
closes. Sessions live in memory: a restart signs everyone out. Wrong passwords
are throttled (5 per client, 50 overall, per 15 minutes → `429
TOO_MANY_REQUESTS`), and a wrong username costs the same time as a wrong
password. The password is only ever compared as an scrypt hash.

**Every write needs the `X-TR-File-Request: 1` header** — uploads, sign-in and
sign-out now; delete and move later. A page on another site can make a browser
send a `POST`, but not one with a custom header (that needs a CORS preflight
this server never grants), so a request carrying it came from the app. Writes
are also refused (`403 CSRF_REJECTED`) when `Sec-Fetch-Site` says another site
sent them or `Origin` names another host — which is why nginx forwards
`$http_host` and the Angular dev proxy keeps `changeOrigin: false`. Reads are
unaffected. An API client other than the app has to send the header too.

The bridge asks for the same account: with signing in on, a connection must
send `login` before anything else is answered (see below).

## The bridge — the same API without HTTP (PRD 001, §8.1)

`App` also exposes `bridge`, a `FileSystemBridge` over the **same**
`FilesService` the routes use — same path resolver, same root confinement,
same upload ceiling. It is what the Electron shell calls instead of talking to
itself over a socket (`prj/desktop`); a server deployment never touches it.

```ts
const response = await app.bridge.dispatch({ command: 'list', path: 'docs' });
// { data: … }  or  { error: { code, message, status, details? } }
```

| Command | Fields | Answers with |
| --- | --- | --- |
| `list` | `path` | the listing `GET /api/fs/list` serves |
| `details` | `path` | the entry `GET /api/fs/details` serves |
| `read` | `path`, `offset?`, `length?`, `maxBytes?` | one chunk: `{ name, size, mimeType, offset, content: Uint8Array }` |
| `upload-begin` | `path`, `filename`, `overwrite` | `{ uploadId }` — or the `CONFLICT` / `BAD_REQUEST` an upload would get, before any bytes |
| `upload-chunk` | `uploadId`, `content` | `{ received }` once the chunk is on its way to disk |
| `upload-commit` | `uploadId` | the stored file's details |
| `upload-abort` | `uploadId` | `{ aborted: true }`; the temp file is discarded |
| `auth-status` | — | `{ required, authenticated, username }` for this connection |
| `login` | `username`, `password` | signs this connection in; `401` / `429` as over HTTP |
| `logout` | — | signs this connection out |

`dispatch(request, session)` takes the connection's `FsBridgeSession` — on the
desktop, one per window — and with signing in on refuses every file-system
command (`UNAUTHORIZED`) until that session has signed in; so does `saveCopy`.

Two rules follow from the channel it is reached through. Requests **are
untrusted** — they come from a renderer, so every field is validated exactly as
a query string would be, and a malformed one is the same `BAD_REQUEST`.
Failures are **returned, not thrown** — an `Error` loses its type, its code and
usually its message crossing a structured clone, so a failure is flattened into
the HTTP error envelope plus the `status` it would have had. That is what lets
the frontend raise one `FsError` for either transport.

**No file crosses whole** (PRD 003, §1). `read` answers at most
`FS_BRIDGE_CHUNK_BYTES` (1 MiB) from `offset`, and an upload is a
begin / chunk… / commit session, so neither process ever holds more than one
chunk of a transfer; an upload left idle for a minute is aborted. `maxBytes`
is checked on every `read`, before anything is read, which is the one place the
bridge is stricter than HTTP.

Downloads are not a command: a destination outside the root must never come
from a renderer. `bridge.saveCopy(path, destination, { onProgress, signal })`
streams a file to a path the desktop shell got from its native Save dialog,
and removes the partial file if it fails or is aborted.

## `/api/fs` — file-system access (PRD 001, §7)

Paths are **root-relative POSIX, no leading slash**; an omitted or empty `path`
means the root itself. Every path is resolved through `FilePathResolver`, which
rejects traversal and symlinks that leave `FILES_ROOT` — it is the only way a
path reaches the file system.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/fs/list?path=` | Directory listing: folders (and links to folders) first, then the rest, in natural order (`file2` before `file10`) |
| GET | `/api/fs/details?path=` | Full metadata for one entry |
| GET | `/api/fs/download?path=` | Stream a file (`Accept-Ranges`, `Content-Disposition: attachment`); a range past the end — any range on an empty file — is `416` |
| POST | `/api/fs/upload?path=&overwrite=` | Upload one file, `multipart/form-data`, field `file` |

Successful JSON responses are `{ "data": … }`; errors are
`{ "error": { "code", "message", "details"? } }`.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed path, listing a file, downloading a directory, upload without a `file` part |
| 401 | `UNAUTHORIZED` | No session, or a wrong username or password |
| 403 | `CSRF_REJECTED` | A write without the `X-TR-File-Request` header, or from another site |
| 429 | `TOO_MANY_REQUESTS` | Too many failed sign-ins |
| 403 | `FORBIDDEN` | Path escapes `FILES_ROOT`, or the OS denies access |
| 404 | `NOT_FOUND` | No such path |
| 409 | `CONFLICT` | Upload target exists and `overwrite` is not `true` |
| 413 | `PAYLOAD_TOO_LARGE` | Upload exceeds `UPLOAD_MAX_BYTES` |
| 500 | `INTERNAL_ERROR` | Anything else |

Notes worth knowing before you call it:

- **Uploads are atomic.** Bytes stream into a hidden sibling `.<name>.<rand>.part`
  and are `rename`d into place on success; any failure, abort or overrun deletes
  the temp file, so a half-written upload never appears under the real name.
- **`overwrite` is true only for the exact string `'true'`.** An existing target
  is otherwise a `409`, and a target that is a directory is a `409` either way.
- **Filenames are basenames.** Busboy reduces a multipart `filename` such as
  `sub/dir.txt` to `dir.txt` before the service sees it; empty, `.` and `..`
  are rejected as `400`. An upload can therefore never write outside `path`.
- **`mimeType` is a guess from the extension** (small built-in table, no
  dependency) and is `null` for directories and unknown extensions; downloads
  fall back to `application/octet-stream`.
- **Symlinks** are reported as `type: 'symlink'`, with `targetType` saying what
  the link leads to — `'directory'`, `'file'`, `'other'`, or `null` when it is
  dangling or leads outside the root. A link to a folder inside the root lists
  like the folder (the paths keep the link's name), and a link to a file
  downloads as the file. `symlinkTarget` (details only) is root-relative, or
  `null` when the link points outside the root.
- **Listings `lstat` in parallel**, 64 entries at a time, so a large folder or
  a network mount is not one syscall round trip per entry.

The frontend client for this API is `prj/frontend/src/app/file-system/`
(`FileSystemService` plus its read and transfer feature classes).
