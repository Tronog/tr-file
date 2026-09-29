// Publishes the distributables to the folder the desktop updates itself from
// (PRD 001, §8.6): every AppImage and `.exe` of this version in release/.
//
//   pnpm --filter @tr-file/desktop publish:share [folder]
//
// The folder defaults to the share (`TR_FILE_UPDATE_DIR` names another). Each
// file is copied under a dot-name and renamed into place, so a running copy
// looking at the share never sees half a file: the updater skips dot-names.
import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const release = join(here, '..', 'release');
const { version } = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));

const DEFAULTS = {
  win32: 'S:\\Library\\Software\\Applications\\Tronog\\TR-File',
  linux: '/S/Library/Software/Applications/Tronog/TR-File',
};
const target = process.argv[2] ?? process.env.TR_FILE_UPDATE_DIR ?? DEFAULTS[process.platform];
if (!target || target === 'off') {
  console.error('No folder to publish to: pass one, or set TR_FILE_UPDATE_DIR.');
  process.exit(1);
}

const names = (await readdir(release)).filter((name) => /\.(appimage|exe)$/i.test(name) && name.includes(`-${version}-`));
if (names.length === 0) {
  console.error(`Nothing of version ${version} in ${release}; run \`pnpm package\` first.`);
  process.exit(1);
}

await mkdir(target, { recursive: true });
for (const name of names) {
  const part = join(target, `.${name}.publishing`);
  try {
    await copyFile(join(release, name), part);
    await rename(part, join(target, name));
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
  console.log(`published ${name} → ${target}`);
}
