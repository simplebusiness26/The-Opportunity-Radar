import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SealedSecret, SecretBox } from '../../ports/secret-box';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;

/**
 * AES-256-GCM sealing with the key supplied by RADAR_SECRET_KEY.
 *
 * The key version is stored alongside each secret so keys can be rotated: a new
 * version is added, new writes use it, and existing secrets are re-sealed on
 * next access rather than in a migration that must decrypt everything at once.
 */
export function createSecretBox(keyBase64: string, keyVersion = 'v1'): SecretBox {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('RADAR_SECRET_KEY must be exactly 32 bytes, base64 encoded.');
  }

  return {
    seal(plaintext: string): SealedSecret {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, nonce);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return {
        ciphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        keyVersion,
        hint: plaintext.length <= 4 ? '' : `...${plaintext.slice(-4)}`,
      };
    },

    open(sealed: SealedSecret): string {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
      // GCM authentication means a tampered ciphertext throws here rather than
      // returning attacker-chosen plaintext.
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

/**
 * Used when RADAR_SECRET_KEY is absent. Storing a credential then fails loudly
 * with an actionable message instead of silently writing it in the clear.
 */
export function unavailableSecretBox(): SecretBox {
  const fail = (): never => {
    throw new Error(
      'Cannot store credentials: RADAR_SECRET_KEY is not configured. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  };
  return { seal: fail, open: fail };
}
