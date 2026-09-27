# nsis-toolset — no Wine needed

The Windows setup (PRD 001, §8.4) is electron-builder's NSIS target, and
building one on Linux normally takes **Wine**: electron-builder builds a stub
installer, runs it once under Wine so that it writes its uninstaller, then
builds the real setup with that uninstaller inside.

The uninstaller is also plain data inside the stub, and electron-builder has a
reader for it (`UninstallerReader` in `app-builder-lib`, which it uses on
macOS instead of Wine). This directory is laid out as a Wine toolset —
`bin/wine`, `lib/`, `wine-home/` — so electron-builder accepts it through
`ELECTRON_BUILDER_WINE_TOOLSET_DIR`, but its `bin/wine` only reads the
uninstaller out of the stub (`extract-uninstaller.cjs`). Nothing is run, and
nothing needs installing: no system Wine, no `sudo`, no Docker image.

`pnpm package` and `pnpm package:win` point electron-builder here. It relies
on two details of electron-builder's NSIS target — the uninstaller's file name
and `UninstallerReader` — and checks for both: a later electron-builder that
moves either fails the build with a message naming this file, never produces a
setup without an uninstaller.
