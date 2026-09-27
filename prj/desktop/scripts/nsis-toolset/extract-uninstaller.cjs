// Stands in for Wine when electron-builder builds the NSIS setup (PRD 001,
// §8.4); see README.md beside this file.
//
// electron-builder builds the setup twice: first a stub whose only job, when
// run, is to write the uninstaller to UNINSTALLER_OUT_FILE — beside it, as
// `<setup name without "exe">__uninstaller.exe` — then the real setup, with
// that uninstaller inside. On Linux it runs the stub under Wine. The
// uninstaller is also plain data inside the stub, and electron-builder carries
// a reader for exactly that (`UninstallerReader`, which it uses on macOS),
// so this reads it out instead of running anything.
'use strict';

const { existsSync } = require('node:fs');
const path = require('node:path');

const installer = process.argv[2];
if (installer === undefined || !installer.endsWith('.exe')) {
  console.error(`nsis-toolset: expected the stub installer to "run", got: ${process.argv.slice(2).join(' ')}`);
  process.exit(2);
}

// electron-builder's own module, from the electron-builder this package uses.
const builder = path.dirname(require.resolve('electron-builder/package.json', { paths: [process.cwd(), __dirname] }));
const { UninstallerReader } = require(require.resolve('app-builder-lib/out/targets/nsis/nsisUtil.js', { paths: [builder] }));

// The name NsisTarget gives it: `path.basename(installer, "exe")` keeps the dot.
const uninstaller = path.join(path.dirname(installer), `${path.basename(installer, 'exe')}__uninstaller.exe`);

UninstallerReader.exec(installer, uninstaller).then(
  () => {
    if (!existsSync(uninstaller)) {
      console.error(`nsis-toolset: no uninstaller at ${uninstaller}`);
      process.exit(1);
    }
  },
  (error) => {
    console.error(`nsis-toolset: could not read the uninstaller out of ${installer}: ${error.message}`);
    process.exit(1);
  },
);
