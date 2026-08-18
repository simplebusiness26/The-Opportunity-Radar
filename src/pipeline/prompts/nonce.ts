import { createHash, randomBytes } from 'node:crypto';

/**
 * Where the per-call nonce that wraps untrusted content comes from.
 *
 * Production uses a random one. Fixture replay needs the assembled prompt to be
 * byte-identical between runs -- the recording is keyed by its hash -- so it
 * derives the nonce from the call's own identity instead.
 *
 * That is safe rather than a concession, and for a specific reason: the
 * assembler strips every occurrence of the nonce out of untrusted content
 * before wrapping it, so content cannot close its own container even if it
 * knows the value. The randomness is defence in depth, not the defence.
 */
export type NonceSource = (label: string) => string;

export function randomNonce(): NonceSource {
  return () => randomBytes(8).toString('hex');
}

export function deterministicNonce(seed: string): NonceSource {
  return (label: string) =>
    createHash('sha256').update(`${seed}\n${label}`).digest('hex').slice(0, 16);
}
