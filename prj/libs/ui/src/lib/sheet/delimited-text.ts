/**
 * Delimited text — CSV, TSV — as rows of cells and back (PRD 015, §1): what
 * a CSV file holds, and what a spreadsheet puts on the clipboard.
 *
 * RFC 4180 as every spreadsheet reads it: a field in double quotes may hold
 * the delimiter, line breaks and `""` for a quote; a record ends at `\n` or
 * `\r\n`. Written back, a field is quoted only when it has to be.
 */

/** A delimited text as cells, and what it takes to write it back the same. */
export interface UiDelimitedText {
  readonly rows: readonly (readonly string[])[];
  readonly delimiter: string;
  /** The text ended with a line break — the usual case — which is kept. */
  readonly trailingNewline: boolean;
}

/** The delimiters a CSV file may use, the first most likely. */
const CANDIDATES = [',', ';', '\t', '|'];

/**
 * The delimiter of `text`: a tab for `.tsv`, else whichever of `,` `;` tab
 * `|` its first line has most of outside quotes — Europe's CSV is `;`.
 */
export function detectDelimiter(text: string, extension = ''): string {
  if (extension === 'tsv' || extension === 'tab') {
    return '\t';
  }
  const counts = new Map<string, number>(CANDIDATES.map((candidate) => [candidate, 0]));
  let quoted = false;
  for (const char of text.slice(0, 64 * 1024)) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, (counts.get(char) as number) + 1);
    }
  }
  let best = ',';
  for (const candidate of CANDIDATES) {
    if ((counts.get(candidate) as number) > (counts.get(best) as number)) {
      best = candidate;
    }
  }
  return best;
}

/** Reads `text` as records of fields separated by `delimiter`. */
export function parseDelimited(text: string, delimiter: string): UiDelimitedText {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let at = 0;
  let quoted = false;
  const length = text.length;
  while (at < length) {
    const char = text[at] as string;
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
      }
      at++;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (char === '\r' && text[at + 1] === '\n') {
        at++;
      }
    } else {
      field += char;
    }
    at++;
  }
  const trailingNewline = length > 0 && (text.endsWith('\n') || text.endsWith('\r')) && !quoted;
  if (length > 0 && !trailingNewline) {
    row.push(field);
    rows.push(row);
  }
  return { rows, delimiter, trailingNewline };
}

/** Writes rows back as delimited text, quoting a field only where it must be. */
export function serializeDelimited(table: UiDelimitedText, lineBreak = '\n'): string {
  const { delimiter } = table;
  const needsQuotes = (field: string): boolean => field.includes(delimiter) || field.includes('"') || field.includes('\n') || field.includes('\r');
  const lines = table.rows.map((row) =>
    row.map((field) => (needsQuotes(field) ? `"${field.replaceAll('"', '""')}"` : field)).join(delimiter),
  );
  return lines.join(lineBreak) + (table.trailingNewline && lines.length > 0 ? lineBreak : '');
}

/** Column `index` as a spreadsheet names it: `A` … `Z`, `AA` … */
export function columnName(index: number): string {
  let name = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}
