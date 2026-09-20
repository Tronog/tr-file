# @tr-file/backend

Express 5 + TypeScript API for the file manager. Composition root in
`src/app.ts`; every feature lives in `src/modules/<name>/` split into routes,
services and models, per `docs/ai/EXPRESS.md`.

## Running it

```bash
pnpm dev        # tsx watch, http://localhost:3000
pnpm build      # tsc → dist/ (runtime only; tests are excluded)
pnpm start      # node dist/main.js
pnpm test       # node:test via tsx, straight from src/
pnpm typecheck  # runtime sources + test sources
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Listen address |
| `API_PREFIX` | `/api` | Mount prefix for every module |
| `FILES_ROOT` | `process.cwd()` | Absolute path all file access is confined to |
| `UPLOAD_MAX_BYTES` | `536870912` (512 MiB) | Per-upload limit |
| `LOG_LEVEL` | `debug` / `info` in production | Log verbosity |
| `NODE_ENV` | `development` | Environment |

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
| `read` | `path`, `maxBytes?` | `{ name, size, mimeType, content: Uint8Array }` |
| `upload` | `path`, `filename`, `content`, `overwrite` | the stored file's details |

Two rules follow from the channel it is reached through. Requests **are
untrusted** — they come from a renderer, so every field is validated exactly as
a query string would be, and a malformed one is the same `BAD_REQUEST`.
Failures are **returned, not thrown** — an `Error` loses its type, its code and
usually its message crossing a structured clone, so a failure is flattened into
the HTTP error envelope plus the `status` it would have had. That is what lets
the frontend raise one `FsError` for either transport.

`read` is the one place the bridge is *stricter* than HTTP: an in-process
caller gets the whole file as one buffer, so `maxBytes` is refused before
anything is read rather than after.

## `/api/fs` — file-system access (PRD 001, §7)

Paths are **root-relative POSIX, no leading slash**; an omitted or empty `path`
means the root itself. Every path is resolved through `FilePathResolver`, which
rejects traversal and symlinks that leave `FILES_ROOT` — it is the only way a
path reaches the file system.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/fs/list?path=` | Directory listing, directories first then files |
| GET | `/api/fs/details?path=` | Full metadata for one entry |
| GET | `/api/fs/download?path=` | Stream a file (`Accept-Ranges`, `Content-Disposition: attachment`) |
| POST | `/api/fs/upload?path=&overwrite=` | Upload one file, `multipart/form-data`, field `file` |

Successful JSON responses are `{ "data": … }`; errors are
`{ "error": { "code", "message", "details"? } }`.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed path, listing a file, downloading a directory, upload without a `file` part |
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
- **Symlinks** are reported as `type: 'symlink'`; `symlinkTarget` is
  root-relative, or `null` when the link points outside the root.

The frontend client for this API is `prj/frontend/src/app/file-system/`
(`FileSystemService` plus its read and transfer feature classes).
