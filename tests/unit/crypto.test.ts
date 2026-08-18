import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, needsRehash, CURRENT_ALGO } from '../../src/adapters/crypto/password';
import { generateToken, hashToken, safeEqual, hashIp } from '../../src/adapters/crypto/tokens';
import { createSecretBox, unavailableSecretBox } from '../../src/adapters/crypto/secret-box';
import { randomBytes } from 'node:crypto';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const record = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', record)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery stapl', record)).resolves.toBe(false);
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('normalises unicode so an equivalent password still works', async () => {
    const composed = 'café-password-123';
    const decomposed = 'café-password-123';
    const record = await hashPassword(composed);
    await expect(verifyPassword(decomposed, record)).resolves.toBe(true);
  });

  it('returns false rather than throwing on a corrupt stored record', async () => {
    await expect(
      verifyPassword('anything', { hash: 'not-base64!!', salt: '??', algo: 'scrypt-nope' }),
    ).resolves.toBe(false);
  });

  it('flags outdated parameters for rehashing', () => {
    expect(needsRehash(CURRENT_ALGO)).toBe(false);
    expect(needsRehash('scrypt-n16384-r8-p1')).toBe(true);
  });
});

describe('tokens', () => {
  it('generates unguessable, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('stores a digest, never the token', () => {
    const token = generateToken();
    const digest = hashToken(token);
    expect(digest).not.toBe(token);
    expect(hashToken(token)).toBe(digest);
  });

  it('compares safely across differing lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('hashes addresses irreversibly and distinctly per deployment', () => {
    const a = hashIp('203.0.113.7', 'salt-one');
    const b = hashIp('203.0.113.7', 'salt-two');
    expect(a).not.toContain('203.0.113');
    expect(a).not.toBe(b);
    expect(hashIp('203.0.113.7', 'salt-one')).toBe(a);
  });
});

describe('secret box', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips a credential', () => {
    const box = createSecretBox(key);
    const sealed = box.seal('sk-live-abcdef123456');
    expect(sealed.ciphertext).not.toContain('sk-live');
    expect(box.open(sealed)).toBe('sk-live-abcdef123456');
  });

  it('keeps only a recognisable hint, not the value', () => {
    const sealed = createSecretBox(key).seal('sk-live-abcdef123456');
    expect(sealed.hint).toBe('...3456');
  });

  it('detects tampering rather than returning altered plaintext', () => {
    const box = createSecretBox(key);
    const sealed = box.seal('sk-live-abcdef123456');
    const tampered = { ...sealed, ciphertext: Buffer.from('tampered value').toString('base64') };
    expect(() => box.open(tampered)).toThrow();
  });

  it('refuses a key of the wrong size', () => {
    expect(() => createSecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('fails loudly, with a remedy, when no key is configured', () => {
    expect(() => unavailableSecretBox().seal('anything')).toThrow(/RADAR_SECRET_KEY/);
  });
});
