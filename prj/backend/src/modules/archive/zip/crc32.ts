import * as zlib from 'node:zlib';

type NativeCrc32 = (data: ArrayBufferView, value?: number) => number;

/**
 * `zlib.crc32` arrived in Node 22.2 (and 20.15); an Electron main process can
 * embed an older Node, where the namespace simply has no such member. Looked
 * up through the namespace rather than imported by name so that absence is
 * `undefined` instead of a link error.
 */
const nativeCrc32: NativeCrc32 | undefined = (zlib as unknown as { crc32?: NativeCrc32 }).crc32;

let table: Uint32Array | null = null;

/** The reflected CRC-32 (IEEE 802.3) table, built on first use only where there is no native one. */
function crcTable(): Uint32Array {
  if (table === null) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
  }
  return table;
}

/**
 * The table-driven CRC-32, continuing from `previous` exactly as
 * `zlib.crc32(data, previous)` does. Exported so the tests can hold it to the
 * native one; everything else goes through `Crc32`.
 */
export function tableCrc32(data: Uint8Array, previous = 0): number {
  const lookup = crcTable();
  let crc = ~previous >>> 0;
  for (let i = 0; i < data.length; i++) {
    crc = (lookup[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return ~crc >>> 0;
}

/** A running CRC-32 over chunks, so a file is checked as it streams rather than held whole. */
export class Crc32 {
  private value = 0;

  /** The CRC-32 of `data`, continuing from `previous` when a stream is checked piecewise. */
  static compute(data: Uint8Array, previous = 0): number {
    return nativeCrc32 ? nativeCrc32(data, previous) >>> 0 : tableCrc32(data, previous);
  }

  update(chunk: Uint8Array): this {
    this.value = Crc32.compute(chunk, this.value);
    return this;
  }

  digest(): number {
    return this.value >>> 0;
  }
}
