/**
 * Prints an `AUTH_PASSWORD_HASH` for a password read from standard input, so
 * the password itself never has to sit in an environment file or a shell's
 * history:
 *
 *     pnpm --filter backend hash-password
 *     printf '%s' 'correct horse' | pnpm --filter backend --silent hash-password
 */
import { hashPassword } from '../modules/auth/password-hash.js';

const chunks: Buffer[] = [];
if (process.stdin.isTTY) {
  process.stderr.write('Password (then Enter, then Ctrl+D): ');
}
for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
}
const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
if (password === '') {
  process.stderr.write('No password given.\n');
  process.exit(1);
}
process.stdout.write(`${await hashPassword(password)}\n`);
