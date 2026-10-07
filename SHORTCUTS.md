# Keyboard shortcuts

The default keys of tr-file. Every key in the **configurable** tables can be changed or
removed in *Settings › Keyboard Shortcuts* (`Ctrl`+`,`), stored per user under
`tr-file.keybindings.v1`; the tables below are the defaults
(`UI_DEFAULT_KEYBINDINGS` in `prj/libs/ui/src/lib/keyboard/keymap.ts` plus
`WORKBENCH_DEFAULT_KEYBINDINGS` in `prj/frontend/src/app/workbench/features/keybindings.feature.ts`).
Navigation keys — arrows, `Home`/`End`, page keys, type-to-find, `Escape`, keys inside menus
and dialogs — are **fixed** (PRD 010, §2).

On macOS `Ctrl` means `Cmd` throughout.

In the app, `F1` (or *Help › Keyboard Shortcuts Cheatsheet*) shows all of this as a cheatsheet —
the configurable keys as they are bound now, the user's changes included.

**Where** is the key's context, as the Keyboard Shortcuts page shows it:

| Where | Meaning |
| --- | --- |
| Anywhere | the whole window (`window`) |
| In a panel | anywhere inside a file panel — its listing, a tab, its toolbar gaps (`panel`) |
| On a row | a row of the list or tree view, or a tile of the icon view (`list`) |
| In the image viewer | an image open in a panel (`image`) |

## Configurable

### Window

| Key | Command | Where |
| --- | --- | --- |
| `Ctrl`+`Shift`+`P`, `Ctrl`+`P` | Command palette | Anywhere |
| `Ctrl`+`Shift`+`F` | Search files by name | Anywhere |
| `Ctrl`+`H` | Show or hide hidden files | Anywhere |
| `Ctrl`+`,` | Settings | Anywhere |
| `` Ctrl+Shift+` `` | Show or hide the bottom panel (the key left of `1`, on any layout) | Anywhere |
| `Ctrl`+`E` | Show or hide the Explorer | Anywhere |
| `Ctrl`+`D` | Show or hide Details | Anywhere |
| `Ctrl`+`/` | Show or hide both sidebars — either shown, both are hidden; both hidden, both come back | Anywhere |
| `Ctrl`+`U` | Check for updates (desktop) | Anywhere |
| `Ctrl`+`S` | Save the file being edited | Anywhere, while a file is being edited |
| `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` | Focus next / previous part: Explorer → each panel → bottom panel (while open) → Details, and round | Anywhere |
| `Ctrl`+`1` … `Ctrl`+`9` | Go to the first … ninth bookmark, in the active panel (desktop; a browser keeps them for its tabs) | Anywhere |

### Function keys (Midnight Commander)

Shown in the status bar's function-key strip. `F2`–`F4` act on the entry the cursor is on;
the rest on the active panel's selection. `F5`/`F6` offer the other panel's folder
(the one active before this one).

| Key | Command | Where |
| --- | --- | --- |
| `F1` | Help — the cheatsheet of every key (PRD 001, §16) | Anywhere |
| `F2` | Rename… | Anywhere |
| `F3` | View — open read-only in a tab | Anywhere |
| `F4` | Edit — in the built-in editor; again, back to viewing. What it cannot edit opens in the system's app | Anywhere |
| `F5` | Copy to… | Anywhere |
| `F6` | Move to… | Anywhere |
| `F7` | New folder… | Anywhere |
| `F8` | Delete permanently (asks first) — `Delete` moves to trash | Anywhere |
| `F9` | Main menu | Anywhere |
| `F10` | Quit (desktop) | Anywhere |

### Panels and tabs

| Key | Command | Where |
| --- | --- | --- |
| `Tab` / `Shift`+`Tab` | Focus next / previous panel, in layout order (only with more than one panel shown); Details describes what its cursor is on | In a panel |
| `/` | Split the panel to the right | In a panel |
| `Ctrl`+`T` | New tab on the same folder | In a panel |
| `Ctrl`+`W` | Close the focused tab | In a panel |
| `Escape` | Close the file viewer's tab — text, markdown, a diff or an image — back to the listing it was opened from | Over a file in a panel |
| `Ctrl`+`PageUp` / `Ctrl`+`PageDown` | Previous / next tab | In a panel |
| `Ctrl`+`↑` | Maximize or restore the panel | In a panel |
| `Ctrl`+`Enter` | Open the entry in a new tab of the other panel | In a panel |
| `Shift`+`F10`, `ContextMenu` | Context menu of the focused entry | In a panel |

### Folders and files

| Key | Command | Where |
| --- | --- | --- |
| `Alt`+`←` / `Alt`+`→` | Back / forward in the panel's history | In a panel |
| `Alt`+`↑` | Up one folder | In a panel |
| `Ctrl`+`R` | Refresh (large folders are refreshed only this way) | In a panel |
| `Escape` | Stop reading a large folder — what has come stays (only while one is being read); in Disk Usage, stop the scan (PRD 013, §2.1.1) | In a panel |
| `Ctrl`+`L` | Edit the path bar — go to a location | In a panel |
| `Ctrl`+`F` | Filter the folder | In a panel |
| `Ctrl`+`Shift`+`N` | New folder… | In a panel |
| `Ctrl`+`C` / `Ctrl`+`X` / `Ctrl`+`V` | Copy / cut / paste entries | In a panel |
| `Ctrl`+`Z` | Undo the last file change | In a panel |
| `Ctrl`+`Shift`+`C` | Copy the full path | In a panel |
| `Ctrl`+`Shift`+`C` twice within a second | Copy the full path the UNIX way (`C:\Users` → `/C/Users`) | In a panel |
| `Enter` | Open — a folder in the panel, a file in a tab | On a row |
| `Backspace` | Up one folder | On a row |
| `Delete` | Move to trash (asks first) | On a row |
| `Shift`+`Delete` | Delete permanently (asks first) | On a row |

### Selection

| Key | Command | Where |
| --- | --- | --- |
| `Space` | Select the entry | On a row |
| `Ctrl`+`Space` | Toggle the entry in the selection | On a row |
| `Insert` | Mark the entry and move down | On a row |
| `*` | Select all or none | On a row |
| `Ctrl`+`A` | Select all | On a row |
| `+` | Select by pattern… | On a row |
| `-` | Unselect by pattern… | On a row |

### Image viewer

| Key | Command | Where |
| --- | --- | --- |
| `PageUp` / `PageDown` | Previous / next image in the folder (round at the ends) | In a panel |
| `+` / `-` | Zoom in / out | In the image viewer |
| `1` | Actual size (100%) | In the image viewer |
| `0` | Fit the whole image (the default) | In the image viewer |

### Task Manager

| Key | Command | Where |
| --- | --- | --- |
| `Ctrl`+`Shift`+`T` | Show Task Manager (desktop; a browser keeps it for reopening a tab) | Anywhere |
| `Delete` | End task (the system's own processes ask first) | On a row |
| `Shift`+`Delete` | End process tree (asks first) | On a row |
| `Shift`+`F10`, `ContextMenu` | The row's menu | In the list |
| `Ctrl`+`F` | Filter the processes | In Task Manager |
| `Ctrl`+`R` | Update now | In Task Manager |

## Fixed

### Task Manager's list

| Key | Action |
| --- | --- |
| `←` / `→` (on the tabs) | Processes / Graph |
| `↑` `↓`, `Home` / `End` (Graph, on the resources) | CPU, Memory, Disk, each network adapter |
| `↑` `↓`, `Home` / `End`, `PageUp` / `PageDown` | Move between the rows (headings are passed over) |
| `→` / `←` | Open / close a group, or step into it / out to it |
| `Enter` | Open / close a group |
| Typing letters | Type-to-find: jump to the next name starting with them |
| `↓` (in the filter box) | Back to the list |

### Listing (list, tree and icon views)

| Key | Action |
| --- | --- |
| `↑` `↓` (and `←` `→` in the icon view) | Move the cursor; the selection follows |
| `Home` / `End` | First / last entry |
| `PageUp` / `PageDown` | A page up / down |
| `Shift` + any of the above | Extend the selection |
| `Ctrl`+`↓` (and the other `Ctrl`+arrows the panel does not bind) | Move the cursor, leaving the selection alone |
| Typing letters | Type-to-find: jump to the next name starting with them |
| `→` / `←` (tree view) | Open a folder in place / close it, or step to its parent |

### Explorer tree

| Key | Action |
| --- | --- |
| `↑` `↓`, `Home` / `End` | Move through the folders |
| `→` / `←` | Open / close a folder, or step to its child / parent |
| `Shift`+`F10`, `ContextMenu` | Context menu |

### Tab bar (focus on a tab)

| Key | Action |
| --- | --- |
| `←` `→`, `Home` / `End` | Move between tabs |
| `Ctrl`+`←` / `Ctrl`+`→` | Move the tab left / right |
| `Delete`, `Backspace` | Close the tab |
| `Shift`+`F10`, `ContextMenu` | Tab context menu |

### Filter box and path bar

| Key | Action |
| --- | --- |
| `Escape` (filter box) | Clear the filter; again, back to the listing |
| `↓`, `Enter` (filter box) | Back to the listing |
| `Enter` (path bar) | Go to the suggestion chosen — the first, unless another was — or, with none shown, to the path typed |
| `↓` / `↑` (path bar) | Choose among the places suggested for what is typed |
| `Tab` (path bar) | Complete to the suggestion chosen (or the first) — a folder with `/`, to go on inside it |
| `Escape` (path bar) | Close the suggestions; again, cancel the edit |

### File viewer

| Key | Action |
| --- | --- |
| `Ctrl`+`A` | Select all of the file's text (and nothing else in the window) |
| `Shift`+arrows, the mouse | Select text |
| `Ctrl`+`C` | Copy the text selected |

### File editor

The editor's own keys; everything else in it is a text field's (undo, the clipboard, selecting).

| Key | Action |
| --- | --- |
| `Tab` / `Shift`+`Tab` | Indent / outdent — every selected line when the selection spans lines |
| `Enter` | New line, indented as this one — one step more after `{`, `[` or `(` |
| `Ctrl`+`F` | Find in the file — the selection, if any, is what is looked for |
| `Enter` / `Shift`+`Enter` (find box), `F3` / `Shift`+`F3` | Next / previous match |
| `Escape` | Close the find box |

### CSV table

Over a `.csv` / `.tsv` file, viewed or edited (`F4`). Excel's keys, fixed as a text field's are.

| Key | Action |
| --- | --- |
| `↑` `↓` `←` `→` | Move the active cell; with `Shift`, extend the selection |
| `Ctrl`+arrows | To the edge of the data (in the table, not maximize) |
| `Home` / `End`, `Ctrl`+`Home` / `Ctrl`+`End` | First / last column of the row; the first / last cell |
| `PageUp` / `PageDown` | A page up / down |
| `Ctrl`+`A` | Select all |
| `Ctrl`+`C` | Copy the selected cells, tab-separated |
| `Ctrl`+`F` | Find in the cells (PRD 015, §2.1) — the active cell's text, the first time |
| `Enter` / `Shift`+`Enter` (find box), `F3` / `Shift`+`F3` | Next / previous matching cell, row by row |
| `Escape` | The find box closed; a range back to its active cell; a single cell, close the file |
| Editing: a key | Replace the cell with what is typed |
| Editing: `F2`, double click | Edit the cell in place |
| Editing: `Enter` / `Tab` (`Shift` back) | Put the value in, and move down / right |
| Editing: `Escape` (in a cell) | Drop what was typed |
| Editing: `Delete`, `Backspace` | Empty the selected cells |
| Editing: `Ctrl`+`X` / `Ctrl`+`V` | Cut / paste — one value pasted fills the selection |
| Editing: `Ctrl`+`Z` / `Ctrl`+`Y` | Undo / redo |

Press a column letter or a row number to select it (`Shift` extends); drag across cells for a range.

### JSON tree

| Key | Action |
| --- | --- |
| `↑` / `↓`, `Home` / `End`, `PageUp` / `PageDown` | Move between values |
| `→` / `←` | Open an object or array, or step into it / close it, or step out to its parent |
| `Space` | Open or close |
| `Enter` | Edit a value; open or close an object or array |
| `F2`, double click | Edit a value, or rename a key |
| `Enter` / `Escape` (editing) | Keep / drop what was typed |
| `Ctrl`+`F` | Search keys and values |
| `Enter` / `Shift`+`Enter` (search box), `F3` / `Shift`+`F3` | Next / previous match |
| `Escape` (search box) | Clear the search; again, back to the tree |

### Image viewer

| Key | Action |
| --- | --- |
| `←` `↑` `→` `↓` | Pan a zoomed image |

### Window zoom (desktop)

The main process's keys, before the page's — so not configurable. In a browser these are the browser's own zoom.

| Key | Action |
| --- | --- |
| `Ctrl`+`=`, `Ctrl`+`+` | Zoom in, a level at a time |
| `Ctrl`+`-` | Zoom out |
| `Ctrl`+`0` | Back to 100 % |

### Sidebars

| Key | Action |
| --- | --- |
| `Ctrl`+`↑` / `Ctrl`+`↓` on a section header | Move the section up / down |
| `Ctrl`+`↑` / `Ctrl`+`↓` on a bookmark | Move the bookmark up / down (or drag it) |
| `↑` / `↓` on a section's resize handle | Resize the sections either side |
| `←` / `→` on a sidebar's edge handle | Resize the sidebar |

### Git pane

| Key | Action |
| --- | --- |
| `Ctrl`+`Enter` in the message box | Commit |

### Command palette and pickers

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move through the items |
| `Enter` | Run / accept |
| `Escape` | Close |
| `F2` (a saved server) | Edit it |
| `Shift`+`Delete` (a saved server) | Remove it |

### Dialogs

| Key | Action |
| --- | --- |
| `Enter` in a dialog's text field | The first button (*OK*, *Rename*, …) |
| `←` / `→` on the buttons | Move between them; `Enter` or `Space` presses one |
| `Escape` | Close without an answer — *Abort* in a file operation's error, *Run in Background* in its progress window |

## Desktop only

| Key | Action |
| --- | --- |
| `` Ctrl+` `` | Show or hide the window, from any application (global) |

A browser keeps some chords for its own tabs and windows — `Ctrl`+`T`, `Ctrl`+`W`,
`Ctrl`+`Tab`, `Ctrl`+`PageUp`/`PageDown`, `Ctrl`+`P` among them — so in a browser they may
never reach the page; in the desktop app they all do. None of the unmodified keys (`/`,
`+`, `-`, digits, letters) act while typing in a text field.
