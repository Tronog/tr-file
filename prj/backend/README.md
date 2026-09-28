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
| `FILES_ROOT` | `process.cwd()` | Absolute path all file access is confined to; `/` on Windows means every drive (PRD 003, §6) |
| `UPLOAD_MAX_BYTES` | `536870912` (512 MiB) | Per-upload limit |
| `LOG_LEVEL` | `debug` / `info` in production | Log verbosity |
| `NODE_ENV` | `development` | Environment |
| `AUTH_USERNAME` | unset | The one account allowed to sign in |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_HASH` | unset | Its password, plain or as made by `pnpm hash-password` (preferred) |
| `AUTH_ENABLED` | see below | `false` runs with no login; `true` refuses to start without an account |
| `AUTH_SESSION_IDLE_HOURS` | `12` | A session unused this long is signed out |
| `GIT_ENABLED` | `true`, `false` in production | Whether `/api/git` may run `git` (PRD 011, §1) — see below |

## Signing in and CSRF (PRD 003, §2)

**Signing in is on unless switched off.** With an account configured, every
`/api` route but `/api/auth/*` and `/api/health` answers `401 UNAUTHORIZED`
without a session. A production server with no account **refuses to start**;
only `AUTH_ENABLED=false` (the desktop shell's default) or a development
server with nothing configured runs open, and says so in its log.

`GET /api/health` answers `{ status, uptimeSeconds, timestamp, version, nodeEnv, timeZone,
utcOffsetMinutes }` — the last two since PRD 001, §13.1: the machine's IANA time zone and its
offset from UTC now, in minutes east, so the status bar can show the server's own date and time
(`serverTime()`, `modules/health/server-time.ts`).

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
| `list-progress` | `token`, `namesFrom?`, `detailsFrom?` | `GET /api/fs/list-progress`'s answer |
| `list-cancel` | `token` | `DELETE /api/fs/list-progress`'s answer |
| `details` | `path`, `recount?` | the entry `GET /api/fs/details` serves |
| `read` | `path`, `offset?`, `length?`, `maxBytes?` | one chunk: `{ name, size, mimeType, offset, content: Uint8Array }` |
| `upload-begin` | `path`, `filename`, `overwrite` | `{ uploadId }` — or the `CONFLICT` / `BAD_REQUEST` an upload would get, before any bytes |
| `upload-chunk` | `uploadId`, `content` | `{ received }` once the chunk is on its way to disk |
| `upload-commit` | `uploadId` | the stored file's details |
| `upload-abort` | `uploadId` | `{ aborted: true }`; the temp file is discarded |
| `auth-status` | — | `{ required, authenticated, username }` for this connection |
| `login` | `username`, `password` | signs this connection in; `401` / `429` as over HTTP |
| `logout` | — | signs this connection out |
| `rename` | `path`, `to` | the entry at `to` — as `POST /api/fs/rename` |
| `mkdir`, `create-file` | `path`, `name` | the new folder / empty file — as `POST /api/fs/mkdir` / `create` |
| `search` | `path`, `query`, `limit?` | `GET /api/fs/search`'s answer |
| `host-paths` | `paths` | `GET /api/fs/host-paths`'s answer |
| `watch` | `watchId` (string or `null`), `paths` | `{ watchId, changed }` — as `POST /api/fs/watch` |
| `op-info` | — | `GET /api/ops/info`: `{ trash: 'server' \| 'system', canRestore }` |
| `op-copy`, `op-move` | `sources`, `destination`, `conflict` | the job, started — as `POST /api/ops/copy` / `move` |
| `op-trash`, `op-delete` | `paths` | the job, started |
| `op-restore` | `ids` | the job, started |
| `op-empty-trash` | — | the job, started |
| `op-status`, `op-cancel` | `jobId` | the job as it stands; `op-cancel` stops it first |
| `op-trash-list` | — | `GET /api/ops/trash-items`'s answer (PRD 001, §14.1) |
| `op-resolve` | `jobId`, `decision` | `POST /api/ops/jobs/:id/resolve`'s answer (PRD 001, Fix 3) |
| `places` | — | `GET /api/fs/places`'s answer |
| `time` | — | the machine's clock: `{ now, timeZone, utcOffsetMinutes }`, as `GET /api/health` reports it (PRD 001, §13.1) |
| `archive-list` | `path`, `inner` | `GET /api/archive/list`'s answer |
| `op-compress` | `sources`, `destination`, `name`, `conflict` | the job, started — as `POST /api/ops/compress` |
| `op-extract` | `path`, `destination`, `conflict` | the job, started — as `POST /api/ops/extract` |

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

Nor is `bridge.localPath(path, session)` (PRD 003, §5): it answers
`{ absolute, name, type, executable }` — where an entry is on this machine,
what it is (a link judged by what it leads to), and whether it is a file with
an execute bit — for the desktop shell to open it with the system's default
app or show it in the file manager. A host path is the main process's
business, never the renderer's; sign-in, the resolver and `404` apply as for
any command.

## `/api/fs` — file-system access (PRD 001, §7)

Paths are **root-relative POSIX, no leading slash**; an omitted or empty `path`
means the root itself. Every path is resolved through `FilePathResolver`, which
rejects traversal and symlinks that leave `FILES_ROOT` — it is the only way a
path reaches the file system.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/fs/list?path=` | Directory listing: folders (and links to folders) first, then the rest, in natural order (`file2` before `file10`). A folder of 1000 entries or more comes back with no entries and `progressive: { token, names }` — `names` the first 1000 (`name`, `type`), read on the way to finding it large; see below |
| GET | `/api/fs/list-progress?token=&namesFrom=&detailsFrom=` | A large folder's reading (PRD 004, §3.1): `{ path, total, names, namesDone, details, gone, done }` — the names after `namesFrom` (the first ones came with the listing) as the worker reads them, 10 000 at most per answer (with the type the directory records; `total` is `null` until the last is read — there is no count of its own), then, once every name is out, the details after `detailsFrom` (`index` into the names, `type`, `size`, dates, `targetType` for links). Answers are capped (10 000 names, 50 000 details) and the same cursors get the same answer; `404` once the reading is forgotten (a minute unasked) |
| DELETE | `/api/fs/list-progress?token=` | Stops reading a large folder nobody wants any more (PRD 004, §3.1.2) and forgets it; an unknown token is no error |
| GET | `/api/fs/details?path=&recount=` | Full metadata for one entry. A folder's `entryCount` stops at 1000 with `entryCountMore: true` (a network share would otherwise be read through on every look); `recount=1` counts it through, and that count is kept and given from then on, until the next `recount=1` |
| GET | `/api/fs/places` | `{ home, places: [{ id, label, kind, path }] }`: where a session starts, and the Places pane (PRD 003, §6) |
| GET | `/api/fs/download?path=&inline=` | Stream a file (`Accept-Ranges`, `Content-Disposition: attachment`, or `inline` for `inline=true`); a range past the end — any range on an empty file — is `416` |
| POST | `/api/fs/upload?path=&overwrite=` | Upload one file, `multipart/form-data`, field `file` |
| POST | `/api/fs/rename` | JSON `{ path, to }`; `to` is the full new path. `200`, the entry's details |
| POST | `/api/fs/mkdir` | JSON `{ path, name }`: an empty folder in `path`. `201`, its details |
| POST | `/api/fs/create` | JSON `{ path, name }`: an empty file in `path`. `201`, its details |
| GET | `/api/fs/host-paths?path=a&path=b` | `{ paths }`: each entry's full path on the server's disk, in the host's own form — what *Copy Path* copies (PRD 004, §1.3.2). Worked out from the path, so an entry that is not there has one too; outside the root is `403` |
| GET | `/api/fs/search?path=&query=&limit=` | `{ path, query, entries, truncated, scanned }`: entries named like `query` beneath `path` |
| POST | `/api/fs/watch` | JSON `{ watchId, paths }` → `{ watchId, changed }`: which of those folders changed since the last call |

Successful JSON responses are `{ "data": … }`; errors are
`{ "error": { "code", "message", "details"? } }`.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed path or body, listing a file, downloading a directory, upload without a `file` part, a bad name, renaming the root or a folder into itself, renaming across disks, an empty search, more than 256 watched folders |
| 401 | `UNAUTHORIZED` | No session, or a wrong username or password |
| 403 | `CSRF_REJECTED` | A write without the `X-TR-File-Request` header, or from another site |
| 429 | `TOO_MANY_REQUESTS` | Too many failed sign-ins |
| 403 | `FORBIDDEN` | Path escapes `FILES_ROOT`, reaches into the server's trash, or the OS denies access |
| 404 | `NOT_FOUND` | No such path |
| 409 | `CONFLICT` | Upload target exists and `overwrite` is not `true`; a rename, new folder or new file onto a taken name; a copy or move with `conflict: 'fail'` onto taken names (`details.conflicts`) |
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
- **Case.** A path that differs from the real one in letter case alone — typed on a
  file system that ignores case, Windows or a Samba share — is answered with the real
  spelling (`path` in a listing or the details), so everything opened from it matches
  what listings report (PRD 004, §4.1). On a drive mapped to a share the share's spelling
  is taken. A link is never swapped for where it leads.
- **Symlinks** are reported as `type: 'symlink'`, with `targetType` saying what
  the link leads to — `'directory'`, `'file'`, `'other'`, or `null` when it is
  dangling or leads outside the root. A link to a folder inside the root lists
  like the folder (the paths keep the link's name), and a link to a file
  downloads as the file. `symlinkTarget` (details only) is root-relative, or
  `null` when the link points outside the root.
- **Listings `lstat` in parallel**, 64 entries at a time, so a large folder or
  a network mount is not one syscall round trip per entry.

Since PRD 003, §5 — the things every file manager has:

- **Rename** takes the entry as itself: a symlink is renamed as a link, never
  followed. `to` is the whole new path, so the same call moves an entry to
  another folder (Undo of a move uses it). Refused: the root on either side,
  anything reserved (`403`), a folder into itself (`400`), a missing folder
  (`404`) or one that is a file (`400`), an unsafe name (`400`), and a taken
  name (`409`) — unless it is the same entry, which is a case-only rename on a
  case-insensitive disk. Across file systems it is a `400`: that is a move,
  with progress, and `/api/ops/move` does it.
- **New folder / new file** check the name as an upload does; the file is
  opened with `wx`, so a name taken in the meantime is a `409`, never a
  truncated file.
- **Search** is case-insensitive; a query with `*` or `?` is a glob over the
  whole name, anything else a substring (an empty one is a `400`). The walk is
  breadth-first, so shallow matches come first, reads 16 folders at a time,
  never walks into a linked folder (a link is still matched, with its
  `targetType`), skips the server's trash, and passes over folders it cannot
  read. `limit` defaults to 500 and is clamped to 2000; the search stops and
  says `truncated: true` at the limit, after 200 000 entries or after 10
  seconds. `scanned` is how many entries it looked at.
- **Watch** is auto-refresh by polling — the frontend calls it every couple of
  seconds with the folders it shows. `watchId: null` starts a session; each
  call replaces the session's folders (at most 256; paths that are not a
  folder in the root are passed over) and answers the ones that changed since
  the previous call, as they were asked. An id the server does not know — it
  restarted, or the session sat idle for 60 s — starts a new session and
  answers *every* folder as changed, since changes may have been missed.
  Folders are watched with `fs.watch` (not recursive: a listing only shows
  direct children), shared between sessions and closed with the last one; a
  watcher that fails, or a folder deleted and made again, counts as a change.
  Where the system has no watcher to give (the inotify limit), the folder's
  `mtime` + `ctime` are compared on each call instead. `App.close()` stops
  every watcher.
- **`inline=true`** (the exact string) serves `Content-Disposition: inline`
  with the same file name, so a browser tab shows a PDF, an image or a video
  instead of saving it, always with `X-Content-Type-Options: nosniff`. It is
  the app's own origin, with the session cookie, so anything that can run
  script as a document — HTML, XHTML, SVG, XML — or whose type is unknown also
  gets `Content-Security-Policy: sandbox`: inert, with an opaque origin.

The frontend client for this API is `prj/frontend/src/app/file-system/`
(`FileSystemService` plus its read and transfer feature classes).

## The whole file system, and places (PRD 003, §6)

`FILES_ROOT` may be `/`: the desktop's default, where the root is the whole
machine. The resolver does not add a second separator to a root that ends in
one, so `/home/me` is inside `/`. On Windows, where there is no one root,
`FILES_ROOT=/` (or `\`) makes the root **the list of drives**
(`FilePathResolver.drives()`): a path's first segment is a drive —
`C:/Users/me` is `C:\Users\me` — the root lists the drives that answer, and
a drive itself, like the root, cannot be renamed, moved or trashed
(`isRoot`). A colon after the drive (a drive-relative path, an NTFS stream)
is a `400`, and nothing leaves the drive it names. Searching the whole of `/`
never walks into `/proc`, `/sys`, `/dev` or `/run`.

`GET /api/fs/places` answers where a session starts (`home`, root-relative)
and the places to list: the root first — named by the host, "Files" on a
server — then whatever the `PlacesProvider` `App` was given names (the
desktop's home, user folders, drives and mounts), each proven to be a folder
inside the root, host paths never disclosed. A server has no provider and
lists its root alone.

`FileSystemBridge.fromLocalPaths(absolute[])` — like `localPath`, a method for
the desktop shell, never a command — answers the root-relative path of each
host path the operating system handed it (a file dropped on the window, a
file on the system clipboard), or `null`.

## `/api/archive` — zips (PRD 003, §6)

The `archive` module: a dependency-free streaming zip writer and a
random-access reader (`src/modules/archive/zip/`, ZIP64 both ways, deflate
and store, CRC and size checked as entries are read), and `ArchiveService`
over them.

| Method | Path | Answers with |
| --- | --- | --- |
| `GET` | `/api/archive/list?path=&inner=` | `{ path, inner, entries: [{ name, path, type, size, modifiedAt }], unsafe }` — one folder of a zip, folders first; folders only deeper entries name are listed too |
| `GET` | `/api/archive/zip?path=a&path=b[&name=]` | the entries as one zip, streamed as it is written (chunked, no length): how a folder, or a selection, is downloaded |

Compress and extract are jobs, at `/api/ops` beside the others:

- **`POST /api/ops/compress`** `{ sources, destination, name, conflict }`: a
  zip of the sources as `destination/name`, folders with everything in them
  and links as links. Written to a hidden `.name.<rand>.part` and renamed
  into place when complete, so a cancelled compress leaves nothing. Refused:
  the root, two sources of one name, a zip written into what it zips.
- **`POST /api/ops/extract`** `{ path, destination, conflict }`: an archive
  with one entry at its top is extracted straight into `destination`; one
  with several goes into a folder named after the archive, so loose files
  never scatter. `conflict` applies to that one top name, as a copy's does.
  An archive's names are never trusted: an entry that would land outside the
  folder it is extracted into — `..`, an absolute path, a drive — is skipped
  and counted, every file is written new (`wx`), links are made last and only
  when they lead somewhere inside what was extracted, and a folder that turns
  out to lead elsewhere on disk is not written into. Modes (without set-id
  bits) and times are kept. Encrypted archives are refused.

Both report `outcome` — the first source and the zip made, the archive and
what it made at the top — which Undo trashes.

## `/api/git` — git (PRD 011, §1)

The `git` module runs the system's `git` program — optional: without one,
`info` says so and every other action answers `503 GIT_UNAVAILABLE`. It is
**off in production unless `GIT_ENABLED=true`**: git runs a repository's
hooks and follows its configuration, which can name programs, so on a server
anyone who can write files into a repository could have code run. The desktop
turns it on — there it is the user's own computer.

A folder is in a repository when it, or a folder above it *inside the root*,
holds a `.git` (a folder, or the file a worktree or submodule has); a
repository around the root is never found. Every request names a folder
(`path`) and acts on its repository; `files` are relative to the repository,
as its status names them. Git is run without a shell, in the repository's
folder, with no terminal to prompt on (`GIT_TERMINAL_PROMPT=0`, its own
session on POSIX) and a deadline — a minute, ten for commit, fetch, pull and
push — so a push that needs a password no helper has fails instead of
hanging. Changes to one repository run one at a time.

| Method | Path | Answers with |
| --- | --- | --- |
| `GET` | `/api/git/info` | `{ available, version, reason }` |
| `GET` | `/api/git/status?path=` | `{ path, repository }` — `null`, or `{ root, branch, head, upstream, ahead, behind, hasRemote, operation, stashes, changes: [{ path, file, from?, area, kind, folder? }], truncated }`; `area` is `staged`, `unstaged`, `untracked` or `conflict` |
| `GET` | `/api/git/log?path=&limit=&skip=` | `{ root, commits: [{ hash, short, author, email, date, subject, refs }], more }` |
| `GET` | `/api/git/branches?path=` | `{ root, branches: [{ name, remote, current, commit, upstream }] }` |
| `GET` | `/api/git/diff?path=&file=&staged=` | `{ root, file, staged, text, binary, truncated }` — a new file is diffed against nothing; cut at 2 MiB |
| `POST` | `/api/git/init` `{ path }` | makes the folder a repository |
| `POST` | `/api/git/stage` / `unstage` `{ path, files }` | `files: []` is every change |
| `POST` | `/api/git/discard` `{ path, files }` | a tracked file back to the index; an untracked one **deleted** |
| `POST` | `/api/git/commit` `{ path, message, amend?, all? }` | `all` stages everything first; the message goes on stdin |
| `POST` | `/api/git/checkout` `{ path, branch }` | a remote branch (`origin/x`) checks out the local one tracking it, made if need be |
| `POST` | `/api/git/branch-create` `{ path, name, checkout? }` / `branch-delete` `{ path, name, force? }` | |
| `POST` | `/api/git/fetch` / `pull` / `push` `{ path }` | a branch with no upstream is pushed to `origin` (or the only remote) and tracks it |
| `POST` | `/api/git/stash` `{ path, message? }` / `stash-pop` `{ path }` | new files are stashed too |

Every `POST` answers with the repository's status afterwards. Refusals:
`400` for a file that is not the repository's or a branch name git would not
take, `409 NOT_A_REPOSITORY`, `422 GIT_FAILED` with git's own reason (its
`hint:` lines left out), `504 GIT_TIMEOUT`. The bridge has the same as one
command, `{ command: 'git', action, …fields }`.

## `/api/ops` — file operations (PRD 005, §1)

Copy, move, move to trash and empty trash, in `src/modules/operations` — and,
since PRD 003 §5, delete for good and restore from the trash. Each is
a **background job**: starting one checks everything that can be checked before
a file is touched and answers `202` with the job at once; the client asks for it
again to see how far it has got — the frontend asks once a second, so progress
costs one small message a second however fast the job runs — and may cancel it.

| Method | Path | Body | Answers with |
| --- | --- | --- | --- |
| `GET` | `/api/ops/info` | — | `{ trash: 'server' \| 'system', canRestore }` |
| `POST` | `/api/ops/copy`, `/api/ops/move` | `{ sources: string[], destination, conflict?, errors? }` | `202`, the job |
| `POST` | `/api/ops/trash`, `/api/ops/delete` | `{ paths: string[], errors? }` | `202`, the job |
| `POST` | `/api/ops/restore` | `{ ids: string[], errors? }` | `202`, the job |
| `POST` | `/api/ops/empty-trash` | — | `202`, the job |
| `GET` | `/api/ops/trash-items` | — | `{ trash, canRestore, canList, items: [{ id, name, location, deletedAt, type, size }] }` — what is in the trash, newest first (PRD 001, §14.1); `location` is root-relative for the server's trash, the host path for a system one; a trash that cannot be listed says `canList: false` |
| `GET` | `/api/ops/jobs/:id` | — | the job |
| `POST` | `/api/ops/jobs/:id/cancel` | — | the job; one that has ended stays as it ended |
| `POST` | `/api/ops/jobs/:id/resolve` | `{ decision: 'skip' \| 'skip-all' \| 'retry' \| 'abort' }` | the job; `409` when it is not `waiting` |

A job is `{ id, kind, state, title, startedAt, finishedAt, totalBytes, doneBytes,
totalItems, doneItems, current, skipped, error, problem, affected, outcome }`: `kind` is
`copy`, `move`, `trash`, `empty-trash`, `delete`, `restore`, `compress` or `extract`; `state` is
`running`, `waiting`, `done`, `failed` or `cancelled`; the totals are `null` while unknown;
`error` is `{ code, message }` when it failed — or was aborted on an entry it could not do;
`problem` is `{ path, code, message }` while it is `waiting`; `affected` names the folders
whose listings it changed, for a client to read again. Finished jobs are kept
for ten minutes.

`outcome` is what Undo needs: `{ source, target }` pairs, filled in as the
top-level entries are done — a copy's source and the copy made of it, a
move's source and where it is now, a trashed entry and the id the trash can
restore it by (only when the trash hands one out), a restored id and the path
it is back at. Skipped entries have none; delete and empty trash have none.

- **`errors`** says what an entry that fails does — one that cannot be read,
  written, moved or removed (PRD 001, Fix 3). `fail` (the default) ends the job
  there, `failed`, as before. `ask` makes it wait instead: `state: 'waiting'`
  with the `problem`, until `POST /jobs/:id/resolve` answers as Midnight
  Commander's dialog does — `skip` passes over it (counted in `skipped`),
  `skip-all` passes over it and every later failure without asking, `retry`
  tries it again, `abort` stops the job (`cancelled`, the failure kept in
  `error`). Cancelling a waiting job aborts it; an unanswered one aborts after
  30 minutes. Copy and move ask entry by entry, a folder's contents included
  (a folder moved across disks keeps its original while anything in it was
  skipped); trash, delete and restore ask per path. Compress, extract and
  empty trash are one thing each and still fail whole.
- **`conflict`** says what to do with a name that is taken at the destination:
  `fail` (the default) refuses before anything is done with `409` and
  `details.conflicts`, naming every clash; `overwrite`, `skip`, or `rename` —
  keep both, as `name copy.ext`, `name copy 2.ext`, …. Copying an entry into
  the folder it is in makes a copy that way; moving it there does nothing.
- **Refused up front** (`400`): an empty or over-long list, a destination that
  is not a folder, a folder into itself, the root itself, anything in or into
  the trash. Every path goes through the same resolver as `/api/fs`.
- **Copies** go entry by entry, a stream per file, so progress is in bytes;
  symlinks are copied as links, never followed; modes and times are kept where
  the OS allows. **Moves** are a `rename`, or a copy then delete across file
  systems.
- **Cancelling** stops the job between two chunks: what was fully copied
  stays, the file being written is removed. Trash, delete and restore stop
  between two entries.
- **Delete** removes entries for good (`rm`, recursively; a link as a link).
  It is refused up front as trash is: the root, anything in the trash
  (emptying it is how that goes), and anything that is not there (`404`).
- **The trash** is a `TrashProvider`. A server keeps its own: `.tr-file-trash`
  in the root, laid out as the freedesktop.org trash is (`files/` and, beside
  each entry, `info/<name>.json` saying where it came from and when). The
  resolver reserves that name, so it is in no listing and no `/api/fs` or
  `/api/ops` path can reach into it. The desktop hands `App` the system trash
  instead (`new App(config, logger, version, { trash })`; see `prj/desktop`).
- **Restore** puts trashed entries back by id — a `TrashProvider` that can
  (`originOf` + `restore`) says so as `canRestore`. The server's trash can: an
  id is the entry's name under `files/`, and its `info/<id>.json` says where it
  came from. A folder that has gone since is made again (the deepest one still
  there is proven inside the root first); a name taken since keeps both, as
  `name copy.ext`, the way a copy's `rename` does. The record goes with the
  entry. A trash that cannot restore (the desktop's system trash — the user's
  own file manager restores from it) refuses with `400`; an unknown id is a
  `404`, before anything is moved.
