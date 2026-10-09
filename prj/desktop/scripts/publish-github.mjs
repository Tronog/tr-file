// Publishes the distributables as a GitHub release (PRD 017, §1): every
// AppImage, `.exe` and mac `.tar.gz` of this version in release/, under the tag
// `v<version>` on the commit checked out here.
//
//   pnpm --filter @tr-file/desktop publish:github [owner/repo]
//
// The repository defaults to the `github` remote (`TR_FILE_GITHUB_REPO` names
// another). It goes through the `gh` CLI, signed in once with `gh auth login`.
// A release that exists already has its files replaced, so a rebuilt version
// can be published again; a new version is a new `version` in package.json.
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const release = join(here, '..', 'release');
const { version } = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));
const tag = `v${version}`;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(...args) {
  const result = run('git', args, { cwd: here });
  return result.status === 0 ? result.stdout.trim() : null;
}

// `owner/repo` from https://github.com/owner/repo(.git) or git@github.com:owner/repo(.git).
function repoOf(url) {
  return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? '')?.[1] ?? null;
}

const repo = process.argv[2] ?? process.env.TR_FILE_GITHUB_REPO ?? repoOf(git('remote', 'get-url', 'github'));
if (!repo) {
  fail('No GitHub repository to publish to: pass owner/repo, set TR_FILE_GITHUB_REPO, or add a `github` remote.');
}

// What `pnpm package` and `pnpm package:mac` make: all of them or no release,
// so nobody finds a version that one platform never gets.
const EXPECTED = [
  [`tr-file-${version}-x86_64.AppImage`, 'pnpm package:linux'],
  [`tr-file-${version}-x64.exe`, 'pnpm package:win'],
  [`tr-file-Setup-${version}-x64.exe`, 'pnpm package:win'],
  [`tr-file-${version}-mac-x64.tar.gz`, 'pnpm package:mac'],
  [`tr-file-${version}-mac-arm64.tar.gz`, 'pnpm package:mac'],
];
const listed = await readdir(release).catch(() => []);
const present = new Set(listed);
const names = listed.filter(
  (name) => /\.(appimage|exe|tar\.gz)$/i.test(name) && name.includes(`-${version}-`),
);
if (names.length === 0) {
  fail(`Nothing of version ${version} in ${release}; run \`pnpm package\` and \`pnpm package:mac\` first.`);
}
const missing = EXPECTED.filter(([name]) => !present.has(name));
if (missing.length > 0) {
  fail(`Missing from ${release}:\n${missing.map(([name, command]) => `  ${name}  (${command})`).join('\n')}`);
}

// The tag is made on GitHub, so the commit it names has to be there already.
const commit = git('rev-parse', 'HEAD');
if (!commit) fail('Not in a git repository.');
const pushed = (git('branch', '-r', '--contains', commit) ?? '')
  .split('\n')
  .some((line) => line.trim().startsWith('github/'));
if (!pushed) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'master';
  fail(`${commit.slice(0, 7)} is not on GitHub yet; run \`git push github ${branch}\` first.`);
}
if (git('status', '--porcelain')) {
  console.warn(`warning: the working tree has changes; the release is tagged at ${commit.slice(0, 7)}, which does not have them.`);
}

if (run('gh', ['--version']).error) fail('The GitHub CLI (`gh`) is not installed.');
if (run('gh', ['auth', 'status']).status !== 0) fail('`gh` is not signed in; run `gh auth login` first.');

const files = names.map((name) => join(release, name));
const exists = run('gh', ['release', 'view', tag, '--repo', repo]).status === 0;

const NOTES = `Desktop builds of tr-file ${version}.

- \`tr-file-${version}-x86_64.AppImage\` — Linux: mark it executable and run it.
- \`tr-file-${version}-x64.exe\` — Windows, portable: nothing to install.
- \`tr-file-Setup-${version}-x64.exe\` — Windows setup: installs for the current user, or updates the installed copy.
- \`tr-file-${version}-mac-x64.tar.gz\`, \`…-mac-arm64.tar.gz\` — macOS (Intel, Apple Silicon).

None of them is signed. Windows shows a SmartScreen warning the first time. On the Mac, once, after unpacking:

\`\`\`bash
xattr -cr tr-file.app && codesign --force --deep -s - tr-file.app
\`\`\`
`;

const args = exists
  ? ['release', 'upload', tag, ...files, '--clobber', '--repo', repo]
  : ['release', 'create', tag, ...files, '--repo', repo, '--target', commit, '--title', `tr-file ${version}`, '--notes', NOTES];
const result = run('gh', args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

for (const name of names) console.log(`published ${name} → ${repo} ${tag}`);
