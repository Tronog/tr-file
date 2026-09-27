# Overview (MISSING)

# Section 1
Browsing, panels and jobs are strong. The biggest gap is that the app can't create or change anything except by copy, move and trash: there's no rename, no new folder and no new file, and the backend has no API for them.

Already solid: list, grid and tree views; split panes and tabs; per-panel back/forward history; a full keyboard model and command palette; copy/move/trash as cancellable background jobs; drag & drop between panels; uploading files dropped in from the OS; previews for markdown, text and images; a details sidebar; the system trash; and remote servers.

Missing: things every file manager has

- Rename (F2), New Folder, New File. Nothing exists in the backend, the bridge or the UI.
- Right-click menus. There are none at all: not on entries, blank space, the tree or tabs. UiContextMenu exists but only draws the menu bar and the Settings menu.
- Sorting by column. The header arrow and the "Sorted by Name" label are for show; the order is whatever the backend sends.
- Filter and search. UiSearchField exists but is never turned on, the Search icon does nothing, and there's no recursive search.
- Typing a path into the address bar. The breadcrumbs can't be edited; only the palette's Jump to Folder takes a typed path.
- Back/Forward buttons. The history works, but only through Alt+←/→.
- Opening a file in its default app, or showing it in the OS file manager. There's no shell.openPath or showItemInFolder, so a PDF or .docx can't be opened at all.
- Undo (Ctrl+Z) and permanent delete (Shift+Delete).
- Auto-refresh. Nothing watches the file system; listings refresh by hand or when a job ends.

Missing: things a good file manager has

- Places / bookmarks (Home, Documents, Downloads, pinned folders, recent). The Places pane and the Bookmarks icon are empty.
- Drives, mounts and free space. There's a single root (your home folder on the desktop), so you can't reach /, C:\, D:\ or USB drives, and no free space is shown.
- Browsing the trash and restoring from it. The server trash keeps the records needed for a restore, but nothing uses them.
- Folder size. Folders show a child count only, and a selection's total counts them as 0 bytes.
- Dragging files out to the OS (startDrag) and the system clipboard. Copy and paste only work inside the app.
- Thumbnails in the grid view. Only the details card shows an image.
- Previews for PDF, audio and video, and syntax highlighting for code.
- Changing permissions or owner. Owners show as numeric uid:gid.
- Zip and unzip.
- Settings and remembered state. The Settings, Selection and View menus are just a disabled "Todo". View mode, layout, tabs and window size are lost on restart.
- Buttons that do nothing: the title bar's sidebar and panel toggles, Customize layout, the sidebars' "…" buttons, and the Outline and Timeline panes.

Missing: desktop polish

- Opening a folder from the command line, or being set as the default folder handler.
- More than one window, a tray icon, and a notification when a long job ends.
- A light theme, or following the OS theme; translations (all text is hard-coded English).
- No macOS build, no auto-update and no code signing. The Windows build is a portable .exe with no installer, by design.
- Nice to have: creating symlinks, checksums, batch rename, and comparing two folders (the two-panel layout suits it). Windows hidden-file attributes aren't detected either; only dotfiles count as hidden.

Suggested order

1. Rename, new folder and new file in the backend, then F2 inline rename and New Folder/File in the File menu and palette.
2. A right-click menu for entries and blank space.
3. Sorting by column and a filter box inside a folder.
4. Open in default app and Show in folder on the desktop.
5. Watching open folders so they refresh themselves.
6. A Places sidebar, drives and free space.
7. Remembering view state and layout, and wiring up the dead buttons.

# Section 2
Missing: things users will notice quickly

1. You can't change permissions, owner or timestamps. The details sidebar shows mode, uid/gid and dates, but nothing can set them. There's no chmod, chown or touch API; chmod/utimes only appear inside copy and extract, to keep the original values. Owner and group show as numbers, not user names.
2. No folder size and no free disk space. Details for a folder give only entryCount. Nothing calculates a folder's total size, and nothing anywhere reports free or total space. Every file manager shows free space in its status bar or Places.
3. Previews stop at text, markdown and images. There's no PDF, audio or video preview, no syntax highlighting and no hex view. PDFs and Office files go to the system app. Thumbnails are made for images only (thumbnails.feature.ts:60), so video and PDF tiles show generic icons. There's also no quick-look key (Space toggles selection).
4. Upload conflicts have no "Keep Both". File operations offer keep-both (name copy.ext), but the upload dialog only has Replace or Skip (transfers.feature.ts:360). The two conflict flows should use the same choices.
5. Undo has no redo. UndoFeature exists, but nothing in the code implements redo, so Ctrl+Y / Ctrl+Shift+Z do nothing.
6. "Open With…" doesn't exist. shell-open only uses the default app (bridge-sessions.ts:257). There's no way to choose another app, no "Open Terminal Here", and no "Open as root/admin". An open-with pane id is still listed in sidebar-panes.feature.ts, but nothing renders it.
7. The list view's columns are fixed. Columns can't be resized, reordered or hidden. Nothing like EXIF data, image dimensions or duration can be added as a column.

Missing: desktop integration

8. Only one window, and the command line is ignored. second-instance just focuses the existing window (main.ts:99). Running tr-file ~/Downloads does nothing, there's no "New Window", and the app can't be set as the system's default folder handler.
9. No auto-update, and no electron-updater. The AppImage and portable .exe only update if the user re-downloads them.
10. Drives can't be mounted, unmounted or ejected. Places lists drives and mounts, but there's no eject, no reaction when a USB stick is plugged in, and no trash per mounted volume.
11. Windows hidden and system attributes are ignored. "Hidden" still means a name starting with a dot.
12. Links can't be created. Copying preserves symlinks, but there's no "Create Link" or shortcut command.

Missing: power-user features

13. Search only matches names. It can't search file contents (files.service.ts:342), and results are capped by a time and count budget. There are no filters by size, date or type.
14. No batch rename, checksums, folder compare or sync. These are the classic dual-pane tools, and the split-panel layout suits them well.
15. Only zip is supported as an archive. The archive module contains nothing but zip/. tar, tar.gz, 7z and rar can't be browsed or extracted.
16. Remote access means tr-file servers only. Remote Computer connects to another tr-file server's API. There's no SFTP, SMB, WebDAV or S3.
17. No tags, colour labels or per-folder view settings. Sort and view are stored per panel, not per folder.
18. ~~No settings screen or keybinding editor.~~ Built (PRD 010): the settings window (General, Appearance, Keyboard Shortcuts) and a configurable key table behind every command key.

Smaller gaps and leftovers

- Changes on disk are found by polling every 2 s (WATCH_POLL_MS). The backend does use fs.watch, but nothing is pushed to the window, so changes appear up to 2 s late.
- Select-by-pattern (e.g. *.jpg) is missing; select all, none and invert exist.
- Leftover mock pane ids (tags, git, open-with) remain in sidebar-panes.feature.ts.
- The UI has no i18n; every string is hard-coded English.
- docs/prd/MISSING.md is an empty file.
