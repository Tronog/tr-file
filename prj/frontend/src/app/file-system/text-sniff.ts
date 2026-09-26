/**
 * Deciding whether bytes are text, by looking at them (PRD 003, §1).
 *
 * The extension is only a hint: `.docx`, `.sqlite`, `.pyc` and every other
 * binary format nobody thought to list would otherwise be "shown" as a screen
 * of mojibake. What decides is the content — the same few rules `file(1)`,
 * git and every editor use:
 *
 * 1. A UTF-16 byte-order mark means text, NULs and all.
 * 2. Otherwise a NUL byte in the sample means binary. Text never has one.
 * 3. So does a sample that is more than a tenth control characters.
 * 4. What is left is text: UTF-8 if it decodes as that strictly, and the
 *    Windows code page every legacy Latin text file is in if it does not.
 */

/** How much of a file the binary checks look at. */
const SAMPLE_BYTES = 8192;

/** Past this share of control characters in the sample, it is not text. */
const MAX_CONTROL_RATIO = 0.1;

export type TextEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'Windows-1252';

export type SniffResult =
  | { readonly kind: 'binary' }
  | { readonly kind: 'text'; readonly text: string; readonly encoding: TextEncoding };

/** Decodes `bytes` as text, or says they are not text. */
export function sniffText(bytes: Uint8Array): SniffResult {
  const utf16 = utf16Encoding(bytes);
  if (utf16 !== null) {
    return { kind: 'text', text: new TextDecoder(utf16.toLowerCase()).decode(bytes), encoding: utf16 };
  }

  const sample = bytes.subarray(0, SAMPLE_BYTES);
  if (sample.includes(0) || controlRatio(sample) > MAX_CONTROL_RATIO) {
    return { kind: 'binary' };
  }

  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    // Not UTF-8, but it passed the binary checks: a legacy 8-bit text file.
    return { kind: 'text', text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

function utf16Encoding(bytes: Uint8Array): TextEncoding | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'UTF-16LE';
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'UTF-16BE';
  }
  return null;
}

/**
 * Share of bytes that no text file contains: C0 controls other than the
 * whitespace ones and `ESC` (terminal logs are full of colour codes), and DEL.
 */
function controlRatio(sample: Uint8Array): number {
  if (sample.length === 0) {
    return 0;
  }
  let controls = 0;
  for (const byte of sample) {
    const whitespace = byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d;
    if ((byte < 0x20 && !whitespace && byte !== 0x1b) || byte === 0x7f) {
      controls += 1;
    }
  }
  return controls / sample.length;
}
