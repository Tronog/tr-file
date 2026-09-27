/**
 * Record signatures and field values of the ZIP format (PKWARE APPNOTE 6.3.x),
 * named once so the writer and the reader cannot disagree about them.
 */

export const SIG_LOCAL_HEADER = 0x04034b50;
export const SIG_DATA_DESCRIPTOR = 0x08074b50;
export const SIG_CENTRAL_HEADER = 0x02014b50;
export const SIG_ZIP64_EOCD = 0x06064b50;
export const SIG_ZIP64_LOCATOR = 0x07064b50;
export const SIG_EOCD = 0x06054b50;

export const LOCAL_HEADER_SIZE = 30;
export const CENTRAL_HEADER_SIZE = 46;
export const EOCD_SIZE = 22;
export const ZIP64_EOCD_SIZE = 56;
export const ZIP64_LOCATOR_SIZE = 20;

/** The largest archive comment, which bounds how far from the end the EOCD can be. */
export const MAX_COMMENT_LENGTH = 0xffff;

/**
 * The value a 32-bit size or offset field holds when the real one is in the
 * ZIP64 extra field. A value that *is* 0xFFFFFFFF must go there too, or a
 * reader would take it for the marker.
 */
export const MAX_UINT32 = 0xffffffff;
export const MAX_UINT16 = 0xffff;

/** General-purpose flag bits. */
export const FLAG_ENCRYPTED = 0x0001;
export const FLAG_DATA_DESCRIPTOR = 0x0008;
export const FLAG_STRONG_ENCRYPTION = 0x0040;
export const FLAG_UTF8 = 0x0800;

export const METHOD_STORE = 0;
export const METHOD_DEFLATE = 8;

/** "Version needed to extract": 2.0 for deflate and folders, 4.5 for ZIP64. */
export const VERSION_DEFAULT = 20;
export const VERSION_ZIP64 = 45;

/** "Version made by": high byte 3 is Unix, which is what makes readers honour the mode in the external attributes. */
export const HOST_UNIX = 3;
/** Some macOS tools say "OS X" rather than Unix; the attribute layout is the same. */
export const HOST_OSX = 19;
export const VERSION_MADE_BY = (HOST_UNIX << 8) | 63;

/** Extra field tags. */
export const EXTRA_ZIP64 = 0x0001;
/** Info-ZIP "UT": a Unix mtime in UTC, where the DOS time is local and has 2 s resolution. */
export const EXTRA_EXTENDED_TIMESTAMP = 0x5455;
/** Info-ZIP Unicode Path: a UTF-8 name for an archive whose header names are CP437. */
export const EXTRA_UNICODE_PATH = 0x7075;

/** MS-DOS directory attribute, in the low byte of the external attributes. */
export const DOS_DIRECTORY = 0x10;

/** Unix file-type bits, as `stat` reports them. */
export const S_IFMT = 0o170000;
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;
