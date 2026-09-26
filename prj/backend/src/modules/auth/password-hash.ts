import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing for the one configured account (PRD 003, §2).
 *
 * scrypt, from Node itself — no dependency, and memory-hard, which is what a
 * password hash has to be. The encoded form carries its own parameters, so a
 * hash made today still verifies if the defaults are raised later:
 *
 *     scrypt:<N>:<r>:<p>:<salt, base64>:<hash, base64>
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Hashes a password into the encoded form `verifyPassword` reads. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, { N, r: R, p: P });
  return [PREFIX, N, R, P, salt.toString('base64'), key.toString('base64')].join(':');
}

/**
 * Whether `password` matches `encoded`, compared in constant time. A hash
 * that cannot be read is a mismatch, not an error: the caller must never be
 * able to tell a malformed configuration from a wrong password by timing.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(':');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return false;
  }
  const [, n, r, p, saltText, keyText] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyText, 'base64');
  if (expected.length === 0) {
    return false;
  }

  try {
    const actual = await scrypt(password, Buffer.from(saltText, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Whether a configured `AUTH_PASSWORD_HASH` is one this module can read. */
export function isPasswordHash(encoded: string): boolean {
  const parts = encoded.split(':');
  return parts.length === 6 && parts[0] === PREFIX && parts.slice(1, 4).every((part) => /^\d+$/.test(part));
}
