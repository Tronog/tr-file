/**
 * Bundles the main process and the preload for PRD 001, §8.3.
 *
 * A packaged desktop app is a single executable, so it cannot carry a pnpm
 * `node_modules` tree with it: the store is a graph of symlinks, half of it is
 * the workspace itself (`@tr-file/backend` is a link to a sibling package),
 * and none of that survives being copied into an `app.asar`. Rather than teach
 * the packager to flatten it, everything the main process needs — the backend,
 * Express, Busboy — is compiled into one file here, and the packaged app
 * depends on nothing but Electron itself.
 *
 * That also makes `pnpm start` run the very same file the distributable does,
 * which is the only way a packaging bug gets noticed before a release.
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '..');

const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

/**
 * The parts of the workspace that have to be built already: this bundle reaches
 * into the backend's `dist/` through its `exports` map, and the packaged app
 * ships the frontend's `ng build` output beside it. Both are someone else's
 * `pnpm build`, so say so plainly instead of failing deep inside a bundler.
 */
const PREREQUISITES = [
  {
    path: join(workspaceRoot, 'backend', 'dist', 'app.js'),
    hint: 'pnpm --filter @tr-file/backend build',
  },
  {
    path: join(workspaceRoot, 'frontend', 'dist', 'frontend', 'browser', 'index.html'),
    hint: 'pnpm --filter frontend build',
  },
];

const missing = PREREQUISITES.filter((prerequisite) => !existsSync(prerequisite.path));
if (missing.length > 0) {
  const lines = missing.map((m) => `  ${relative(workspaceRoot, m.path)}  →  ${m.hint}`);
  throw new Error(`the workspace is not built yet:\n${lines.join('\n')}`);
}

/**
 * `import.meta.url` has no meaning in the CommonJS output, and one line of the
 * shell uses it (to find the preload beside itself). Rewrite it to the CommonJS
 * equivalent rather than trusting the bundler's own substitution to stay.
 */
const IMPORT_META_URL = '__trFileModuleUrl';

const shared = {
  bundle: true,
  platform: 'node',
  // Electron 44's Node. Bundling for anything older would only mean shipping
  // downlevelled code to a runtime that does not need it.
  target: 'node22',
  format: 'cjs',
  // Electron is the runtime, not a dependency: it is resolved from inside the
  // executable, and bundling the npm package's JavaScript stub would break it.
  external: ['electron'],
  minify: false,
  sourcemap: true,
  logLevel: 'info',
  absWorkingDir: packageRoot,
};

await build({
  ...shared,
  entryPoints: [join(packageRoot, 'src', 'main.ts')],
  outfile: join(packageRoot, 'dist', 'main.cjs'),
  banner: {
    js: `const ${IMPORT_META_URL} = require('node:url').pathToFileURL(__filename).href;`,
  },
  define: {
    'import.meta.url': IMPORT_META_URL,
    // The packaged app has no npm running above it, so the version it reports
    // has to be baked in at build time.
    'process.env.npm_package_version': JSON.stringify(manifest.version),
  },
});

await build({
  ...shared,
  entryPoints: [join(packageRoot, 'src', 'preload.cts')],
  outfile: join(packageRoot, 'dist', 'preload.cjs'),
});
