/**
 * Entry names: making one safe to use as a relative path, and decoding the
 * bytes an archive stores it as.
 */

/**
 * Code page 437, bytes 0x80–0xFF. The ZIP spec's default for names without
 * the UTF-8 flag, and what old Windows and DOS tools actually wrote; mapping
 * it fully (not just ASCII) turns `Ã¼ber.txt` back into `über.txt` for them.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Not `fatal`: a malformed UTF-8 name becomes U+FFFD, readable and harmless, rather than an archive that will not open. */
const utf8Decoder = new TextDecoder('utf-8');

export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

export function decodeCp437(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    result += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80]!;
  }
  return result;
}

/**
 * `name` as a relative, `/`-separated path with no empty or `.` segments and
 * no trailing slash — or `null` when it cannot be used as one: absolute, a
 * drive letter, a `..` segment anywhere, a NUL, or nothing left at all.
 *
 * A backslash counts as a separator. The spec forbids it, but Windows tools
 * write it anyway, and treating it as an ordinary character is exactly how
 * `..\..\evil` slips past a check that only splits on `/`. The price is that
 * a Unix file whose name holds a backslash becomes a folder — which is also
 * what every Windows extractor would do with it.
 *
 * This is the whole defence against "zip slip" at the name level; whoever
 * extracts must still refuse to follow symlinks the archive itself created.
 */
export function normalizeEntryName(name: string): string | null {
  if (name.includes('\0')) {
    return null;
  }
  const slashed = name.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '..') {
      return null;
    }
    if (segment !== '' && segment !== '.') {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? null : segments.join('/');
}
