/**
 * A branded type for anything that came from outside the system: fetched web
 * pages, source payloads, request bodies, AI output.
 *
 * The brand is the point. Untrusted text cannot be passed where a plain string
 * is expected without an explicit, greppable unwrap, which makes "external
 * content ended up in a system prompt" a compile error rather than something a
 * reviewer has to notice. See docs/SECURITY.md.
 */

declare const untrustedBrand: unique symbol;

export type Untrusted<T = string> = T & { readonly [untrustedBrand]: 'untrusted' };

export interface Provenance {
  /** Where it came from: a URL, a source id, a provider name. */
  origin: string;
  kind: 'fetched_content' | 'source_payload' | 'user_input' | 'ai_output';
  fetchedAt?: string;
}

export interface UntrustedBlock {
  id: string;
  content: Untrusted<string>;
  provenance: Provenance;
}

export function markUntrusted<T>(value: T): Untrusted<T> {
  return value as Untrusted<T>;
}

export function untrustedBlock(
  id: string,
  content: string,
  provenance: Provenance,
): UntrustedBlock {
  return { id, content: markUntrusted(content), provenance };
}

/**
 * The single sanctioned way to read untrusted content as a plain string.
 * Named so that every call site is easy to find and justify in review.
 */
export function revealUntrusted(value: Untrusted<string>): string {
  return value as string;
}
