import { createHash } from 'node:crypto';

/**
 * Content fingerprints for near-duplicate detection.
 *
 * Exact hashes catch verbatim reposts; simhash catches the far more common case
 * of the same content with a different headline, a trimmed intro, or an added
 * editorial paragraph.
 */

/** Normalises text so cosmetic differences do not create new identities. */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[>|]+/gm, ' ')
    .replace(/[*_`#~]+/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normaliseText(text)).digest('hex');
}

export function tokenize(text: string): string[] {
  const normalised = normaliseText(text);
  return normalised ? normalised.split(' ').filter((token) => token.length > 1) : [];
}

/** Overlapping word n-grams: the unit simhash actually compares. */
export function shingles(tokens: string[], size = 3): string[] {
  if (tokens.length === 0) return [];
  if (tokens.length <= size) return [tokens.join(' ')];
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - size; i += 1) {
    out.push(tokens.slice(i, i + size).join(' '));
  }
  return out;
}

function hash64(value: string): bigint {
  // The first 8 bytes of SHA-256 give a well-distributed 64-bit value without
  // pulling in a separate hashing dependency.
  const digest = createHash('sha256').update(value).digest();
  return digest.readBigUInt64BE(0);
}

/**
 * 64-bit simhash. Similar documents produce values differing in few bits, so
 * near-duplicates are found by Hamming distance rather than exact match.
 */
export function simhash(text: string): bigint {
  const grams = shingles(tokenize(text));
  if (grams.length === 0) return 0n;

  const weights = new Array<number>(64).fill(0);
  const counts = new Map<string, number>();
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);

  for (const [gram, count] of counts) {
    const value = hash64(gram);
    for (let bit = 0; bit < 64; bit += 1) {
      const isSet = (value >> BigInt(bit)) & 1n;
      weights[bit] = (weights[bit] ?? 0) + (isSet === 1n ? count : -count);
    }
  }

  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if ((weights[bit] ?? 0) > 0) result |= 1n << BigInt(bit);
  }
  return result;
}

/**
 * How far apart two simhashes may be and still be the same document.
 *
 * Short texts -- a forum comment, a review, a job advert -- produce few
 * shingles, so adding a single word moves many bits. A fixed threshold tuned
 * for articles silently misses reposts of exactly the material Radar reads
 * most, so the bar widens as the document gets shorter and the cascade
 * compensates by demanding stronger confirmation.
 */
export function simhashThresholdFor(tokenCount: number): number {
  if (tokenCount >= 200) return 3;
  if (tokenCount >= 60) return 6;
  return 12;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** Jaccard similarity over token sets. Used for titles and entity overlap. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function titleSimilarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}

export function textSimilarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}

/**
 * How much of `candidate` is contained in `source`. High containment with a
 * lower-tier candidate indicates syndication or quotation rather than an
 * independent observation.
 */
export function containment(candidate: string, source: string): number {
  const candidateGrams = new Set(shingles(tokenize(candidate), 5));
  if (candidateGrams.size === 0) return 0;
  const sourceGrams = new Set(shingles(tokenize(source), 5));

  let shared = 0;
  for (const gram of candidateGrams) if (sourceGrams.has(gram)) shared += 1;
  return shared / candidateGrams.size;
}
