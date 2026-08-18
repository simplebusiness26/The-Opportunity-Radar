export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
  /** Last few characters of the plaintext, so an owner can recognise a key. */
  hint: string;
}

/**
 * Encrypts owner-supplied credentials at rest. Provider API keys, source tokens
 * and webhook secrets never touch the database in plaintext.
 */
export interface SecretBox {
  seal(plaintext: string): SealedSecret;
  open(sealed: SealedSecret): string;
}
