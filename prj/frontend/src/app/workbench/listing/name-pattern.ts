/**
 * The patterns `+` and `-` select and unselect by (PRD 004, §2) — Midnight
 * Commander's shell patterns: `*` is any run of characters, `?` any one, and
 * `[…]` one of a set (`[!…]` or `[^…]` one not in it). Several patterns are
 * separated by `;`, and a name matching any of them matches: `*.jpg;*.png`.
 *
 * A pattern matches the whole name, ignoring case, as a file manager's
 * patterns do on every platform people type them on.
 */
export function namePattern(text: string): (name: string) => boolean {
  const patterns = text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => new RegExp(`^${toRegExp(part)}$`, 'iu'));
  return (name) => patterns.some((pattern) => pattern.test(name));
}

/** Why `text` is not a pattern, or `null` when it is one. */
export function patternProblem(text: string): string | null {
  if (text.split(';').every((part) => part.trim() === '')) {
    return 'Type a pattern, such as *.txt.';
  }
  return null;
}

function toRegExp(glob: string): string {
  let out = '';
  for (let at = 0; at < glob.length; at += 1) {
    const character = glob[at] as string;
    if (character === '*') {
      out += '.*';
    } else if (character === '?') {
      out += '.';
    } else if (character === '[') {
      const close = glob.indexOf(']', at + 2);
      if (close === -1) {
        out += '\\[';
        continue;
      }
      let set = glob.slice(at + 1, close);
      const negated = set.startsWith('!') || set.startsWith('^');
      if (negated) {
        set = set.slice(1);
      }
      out += `[${negated ? '^' : ''}${set.replace(/[\\\]^]/g, '\\$&')}]`;
      at = close;
    } else {
      out += character.replace(/[.+^${}()|\\/\]-]/g, '\\$&');
    }
  }
  return out;
}
