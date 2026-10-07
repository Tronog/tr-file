#!/usr/bin/env node
/**
 * The libraries' boundaries (PRD 001, §17.1): what each may import.
 *
 * - `@tr-file/ui` is generic: no file manager (`@tr-file/file-ui`), no HTTP,
 *   nothing of an application.
 * - `@tr-file/file-ui` is the file manager's components on `@tr-file/ui`: no
 *   HTTP, nothing of an application.
 * - Neither reaches into another package's sources by path.
 *
 * Business — anything that talks to a backend — is the application's.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const RULES = [
  { dir: 'libs/ui/src', forbidden: [/@tr-file\/file-ui/, /@angular\/common\/http/, /\/frontend\//, /\.\.\/\.\.\/\.\.\/\.\.\//] },
  { dir: 'libs/file-ui/src', forbidden: [/@angular\/common\/http/, /\/frontend\//, /libs\/ui\/src/, /\.\.\/\.\.\/\.\.\/\.\.\//] },
];

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

const problems = [];
for (const { dir, forbidden } of RULES) {
  for (const file of files(join(root, dir))) {
    const imports = [...readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*from\s+'([^']+)'/g)].map((match) => match[1]);
    for (const spec of imports) {
      if (forbidden.some((pattern) => pattern.test(spec))) {
        problems.push(`${relative(root, file)}: imports '${spec}'`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Library boundaries broken (PRD 001, §17.1):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Library boundaries hold.');
