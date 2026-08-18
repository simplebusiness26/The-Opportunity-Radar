/**
 * Making arbitrary text safe to store.
 *
 * Two sources of trouble converge here: content fetched from the internet, and
 * error messages from the database driver -- which embed the failing query's
 * parameters, and those can include binary columns such as packed embeddings.
 *
 * Storing either unchecked means a text column receiving bytes that are not
 * valid UTF-8, which PostgreSQL rejects. The resulting error then replaces the
 * original one and the actual failure is lost. That is worse than the encoding
 * problem itself: it turns a clear fault into a misleading one.
 */

/** Characters PostgreSQL cannot store in a text column, or that hide content. */
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const UNSTORABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g;

export interface SanitiseOptions {
  maxLength?: number;
  /** Replaces a run of removed characters, so the elision is visible. */
  placeholder?: string;
}

export function sanitiseForStorage(input: string, options: SanitiseOptions = {}): string {
  const maxLength = options.maxLength ?? 4000;
  const placeholder = options.placeholder ?? '';

  const cleaned = input
    // Lone surrogates are valid in a JavaScript string but cannot be encoded as
    // UTF-8, which is exactly how a binary buffer read as text arrives here.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, placeholder)
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, placeholder)
    .replace(UNSTORABLE, placeholder)
    .replace(/�+/g, placeholder);

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/**
 * A message safe to store and useful to read.
 *
 * Driver errors append the failing statement and every bound parameter, which
 * for Radar includes packed embeddings. The dump is removed rather than
 * sanitised character by character: it is unreadable either way, and keeping it
 * would bury the sentence that actually explains the failure.
 */
export function sanitiseErrorMessage(input: unknown, maxLength = 1000): string {
  const raw = input instanceof Error ? input.message : String(input);

  const withoutParams = raw
    .replace(/\bparams:[\s\S]*$/i, '')
    .replace(/\bvalues \([^)]*\)/gi, 'values (...)')
    .trim();

  const message = sanitiseForStorage(withoutParams, { maxLength });
  return message || 'The operation failed without a readable message.';
}
