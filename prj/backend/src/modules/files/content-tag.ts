/**
 * A short fingerprint of a file's bytes (PRD 005, §4): what an editor read,
 * sent back with what it saves, so a file changed on disk meanwhile is not
 * overwritten unasked. Not a time: a link's details carry the link's own, and
 * a second's resolution misses a quick change.
 *
 * cyrb53 run twice — 64 bits — after the length. Not cryptographic, and need
 * not be: it tells two versions of one file apart. The frontend computes the
 * very same (`prj/frontend/src/app/file-system/content-tag.ts`) — keep them
 * in step; both are pinned by the same test vectors.
 */
export function contentTag(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (const byte of bytes) {
    h1 = Math.imul(h1 ^ byte, 2654435761);
    h2 = Math.imul(h2 ^ byte, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${bytes.length}:${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
