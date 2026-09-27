/**
 * What went wrong, in terms a caller can act on: a route answers `NOT_A_ZIP`
 * or `CORRUPT` with a 4xx and the others with a message, without parsing text.
 */
export type ZipErrorCode =
  /** No end of central directory record: not a ZIP at all. */
  | 'NOT_A_ZIP'
  /** A record is truncated, points outside the file, or has the wrong signature. */
  | 'CORRUPT'
  /** A feature this library does not implement (split archives, compression methods other than store/deflate). */
  | 'UNSUPPORTED'
  /** The entry is encrypted; there is no password support. */
  | 'ENCRYPTED'
  /** Over one of the sanity bounds, or a size hint the data outgrew. */
  | 'TOO_LARGE'
  /** An entry's bytes do not match the CRC-32 its header promises. */
  | 'CRC_MISMATCH'
  /** An entry inflated to more or fewer bytes than its header promises. */
  | 'SIZE_MISMATCH'
  /** An entry name that is absolute, climbs out with `..`, or is otherwise unusable. */
  | 'INVALID_NAME'
  /** The writer cannot go on: it was finished, or an earlier entry left the output half-written. */
  | 'WRITER_FAILED';

/** Every failure this library raises itself; stream and file-system errors pass through as they are. */
export class ZipError extends Error {
  override readonly name = 'ZipError';

  constructor(
    readonly code: ZipErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
