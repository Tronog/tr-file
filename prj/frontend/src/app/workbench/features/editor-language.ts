import type { UiSyntaxLanguage } from '@tr-file/ui';

/** Names of shell scripts that carry no extension. */
const SHELL_NAMES = new Set(['.bashrc', '.bash_profile', '.bash_aliases', '.bash_logout', '.profile', '.zshrc', '.zprofile', '.zshenv', '.kshrc']);

const BY_EXTENSION: Readonly<Record<string, UiSyntaxLanguage>> = {
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ksh: 'bash',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  webmanifest: 'json',
};

/** How the editor's status line names each language (PRD 005, §4). */
export const LANGUAGE_LABELS: Readonly<Record<UiSyntaxLanguage, string>> = {
  plain: 'Plain Text',
  markdown: 'Markdown',
  bash: 'Shell Script',
  json: 'JSON',
};

/**
 * The language a file is coloured in (PRD 005, §4): by its extension, by the
 * name of a shell's own files, else by a `#!` line naming a shell.
 */
export function languageOf(path: string, text: string): UiSyntaxLanguage {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (SHELL_NAMES.has(name)) {
    return 'bash';
  }
  const dot = name.lastIndexOf('.');
  const byExtension = dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined;
  if (byExtension !== undefined) {
    return byExtension;
  }
  return /^#!.*\b(?:ba|z|k|da)?sh\b/.test(text.slice(0, 200)) ? 'bash' : 'plain';
}

/**
 * Where a JSON text stops being JSON (PRD 005, §5): the line and the reason,
 * or `null` when it parses. The engine says *where* as an offset, a line and
 * column, or not at all; what it says is turned into a line.
 */
export function jsonProblemOf(text: string): { readonly line: number; readonly message: string } | null {
  if (text.trim() === '') {
    return null;
  }
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lineColumn = /line (\d+) column (\d+)/i.exec(message);
    const position = /position (\d+)/i.exec(message);
    const line = lineColumn !== null ? Number(lineColumn[1]) : position !== null ? text.slice(0, Number(position[1])).split('\n').length : text.split('\n').length;
    return { line, message: message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '').replace(/ at line \d+ column \d+.*$/, '') };
  }
}
