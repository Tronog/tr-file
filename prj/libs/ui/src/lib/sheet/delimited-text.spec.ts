import { columnName, detectDelimiter, parseDelimited, serializeDelimited } from './delimited-text';

/** PRD 015, §1 — CSV read into cells, and written back the same. */
describe('delimited text', () => {
  it('reads quoted fields — the delimiter, line breaks and quotes in them — and CRLF', () => {
    const table = parseDelimited('name,note\r\n"Smith, J","said ""hi""\nthen left"\r\nx,\r\n', ',');
    expect(table.rows).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"\nthen left'],
      ['x', ''],
    ]);
    expect(table.trailingNewline).toBe(true);
  });

  it('writes back what it read, quoting only where it must', () => {
    const text = 'a;b\n"1;2";"x""y"\n3;\n';
    const table = parseDelimited(text, ';');
    expect(serializeDelimited(table)).toBe(text);
    expect(serializeDelimited({ ...table, trailingNewline: false }, '\r\n')).toBe('a;b\r\n"1;2";"x""y"\r\n3;');
  });

  it('reads a last line without a line break, and an empty text as no rows', () => {
    expect(parseDelimited('a,b\n1,2', ',')).toEqual({ rows: [['a', 'b'], ['1', '2']], delimiter: ',', trailingNewline: false });
    expect(parseDelimited('', ',').rows).toEqual([]);
  });

  it('finds the delimiter outside quotes on the first line', () => {
    expect(detectDelimiter('a;b;"c,d,e"\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b\n')).toBe(',');
    expect(detectDelimiter('a\tb')).toBe('\t');
    expect(detectDelimiter('a,b', 'tsv')).toBe('\t');
  });

  it('names columns as a spreadsheet does', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
