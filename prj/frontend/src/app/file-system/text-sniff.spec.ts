import { sniffText } from './text-sniff';

/** PRD 003, §1 — text is decided by the bytes, not by the extension. */
describe('sniffText', () => {
  const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('reads UTF-8 text, accents and all', () => {
    expect(sniffText(utf8('héllo wörld\n'))).toEqual({ kind: 'text', text: 'héllo wörld\n', encoding: 'UTF-8' });
  });

  it('drops a UTF-8 byte-order mark', () => {
    expect(sniffText(bytes(0xef, 0xbb, 0xbf, 0x61))).toMatchObject({ kind: 'text', text: 'a' });
  });

  it('reads an empty file as empty text', () => {
    expect(sniffText(bytes())).toEqual({ kind: 'text', text: '', encoding: 'UTF-8' });
  });

  /** `.docx`, `.xlsx`, `.jar` — all ZIP containers, none on any extension list. */
  it('recognises a ZIP container as binary', () => {
    expect(sniffText(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00))).toEqual({ kind: 'binary' });
  });

  it('recognises a SQLite database as binary', () => {
    expect(sniffText(new Uint8Array([...utf8('SQLite format 3'), 0, 16, 0]))).toEqual({ kind: 'binary' });
  });

  it('recognises bytes that are mostly control characters, even without a NUL', () => {
    expect(sniffText(bytes(0x01, 0x02, 0x03, 0x41, 0x04, 0x05))).toEqual({ kind: 'binary' });
  });

  /** Terminal logs are full of colour codes; `ESC` is not a binary tell. */
  it('keeps ANSI-coloured logs as text', () => {
    expect(sniffText(utf8('\u001b[31merror\u001b[0m: failed\n'))).toMatchObject({ kind: 'text', encoding: 'UTF-8' });
  });

  it('reads a legacy Latin text file in its code page rather than as garbage', () => {
    // "café" in Windows-1252: é is 0xE9, which is not valid UTF-8 on its own.
    expect(sniffText(bytes(0x63, 0x61, 0x66, 0xe9))).toEqual({ kind: 'text', text: 'café', encoding: 'Windows-1252' });
  });

  it('reads UTF-16 by its byte-order mark, NULs and all', () => {
    expect(sniffText(bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00))).toEqual({ kind: 'text', text: 'hi', encoding: 'UTF-16LE' });
  });

  /** A NUL past the sample does not make a long text file binary. */
  it('only looks at the start of the file for binary tells', () => {
    const long = new Uint8Array(9000).fill(0x61);
    long[8999] = 0;

    expect(sniffText(long)).toMatchObject({ kind: 'text' });
  });
});
