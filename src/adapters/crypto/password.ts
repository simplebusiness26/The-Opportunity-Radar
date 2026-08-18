import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import type { PasswordHasher, PasswordRecord } from '../../ports/crypto';

/**
 * `promisify` drops the options overload, so scrypt is wrapped by hand to keep
 * the cost parameters type-checked.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing with scrypt from the standard library.
 *
 * scrypt is memory-hard and ships with Node, so Radar needs no native build
 * step and no third-party dependency in its authentication path. Parameters are
 * recorded per user so they can be raised later and old hashes rehashed on the
 * next successful sign-in without invalidating anyone's password.
 */

export const CURRENT_ALGO = 'scrypt-n32768-r8-p1';
const KEY_LENGTH = 64;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

function parseAlgo(algo: string): ScryptParams {
  const match = /^scrypt-n(\d+)-r(\d+)-p(\d+)$/.exec(algo);
  if (!match) throw new Error(`Unsupported password algorithm: ${algo}`);
  return { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
}

export async function hashPassword(password: string, algo = CURRENT_ALGO): Promise<PasswordRecord> {
  const { N, r, p } = parseAlgo(algo);
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
  return { hash: derived.toString('base64'), salt: salt.toString('base64'), algo };
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed
 * stored record, so a corrupt row cannot be distinguished from a wrong password.
 */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  try {
    const { N, r, p } = parseAlgo(record.algo);
    const salt = Buffer.from(record.salt, 'base64');
    const expected = Buffer.from(record.hash, 'base64');
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function needsRehash(algo: string): boolean {
  return algo !== CURRENT_ALGO;
}

/**
 * Burns roughly the same CPU as a real verification. Called when an account does
 * not exist, so sign-in timing does not reveal which emails are registered.
 */
export async function dummyVerify(): Promise<void> {
  const { N, r, p } = parseAlgo(CURRENT_ALGO);
  await scrypt('invalid', randomBytes(16), KEY_LENGTH, { N, r, p, maxmem: 256 * 1024 * 1024 });
}

export const scryptPasswordHasher: PasswordHasher = {
  hash: (password) => hashPassword(password),
  verify: (password, record) => verifyPassword(password, record),
  needsRehash,
  dummyVerify,
};
