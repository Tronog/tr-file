# Packaging resources

electron-builder's `buildResources` directory (`directories.buildResources` in
`../electron-builder.yml`). It is not shipped inside the app — it is what the
packager reads *while* building one.

| File | Used by |
| --- | --- |
| `icon.png` | Linux (512×512, installed into the AppImage's hicolor theme) |
| `icon.ico` | Windows (256 down to 16, so the taskbar and Explorer each get a real size rather than a downscale) |

Both draw the same thing the app is: the activity bar, and the two panels of
§6.1. Replacing them is a matter of dropping in files of the same names and
sizes; nothing in the code refers to them.
