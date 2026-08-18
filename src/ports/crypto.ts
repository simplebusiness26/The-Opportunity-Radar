export interface PasswordRecord {
  hash: string;
  salt: string;
  algo: string;
}

/**
 * Password hashing behind a port for two reasons: the cost parameters are a
 * deployment decision rather than a domain one, and tests can substitute a cheap
 * implementation instead of paying for real scrypt on every fixture user.
 */
export interface PasswordHasher {
  hash(password: string): Promise<PasswordRecord>;
  verify(password: string, record: PasswordRecord): Promise<boolean>;
  /** True when the stored record used weaker parameters than the current ones. */
  needsRehash(algo: string): boolean;
  /** Burns comparable CPU when no account exists, so timing reveals nothing. */
  dummyVerify(): Promise<void>;
}

export interface TokenService {
  /** A fresh opaque 256-bit token. */
  generate(): string;
  /** Digest stored in place of the token itself. */
  hash(token: string): string;
  /** Constant-time comparison for caller-supplied secrets. */
  safeEqual(a: string, b: string): boolean;
  /** One-way, salted address hash for rate limiting and audit. */
  hashIp(ip: string, salt: string): string;
}
