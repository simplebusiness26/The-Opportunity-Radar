import { createHash } from 'node:crypto';

/**
 * A deterministic lexical embedding.
 *
 * Radar must work with no AI provider connected, and near-duplicate detection
 * and coarse clustering need vectors. This produces them from the text alone:
 * hashed character 4-grams and word unigrams, sublinear term frequency, L2
 * normalised.
 *
 * It is genuinely lexical, not semantic. It will not recognise that "churn" and
 * "customers leaving" mean the same thing. Everything it produces is labelled
 * `lexical-v1` so the interface never claims semantic matching that did not
 * happen, and a real embedding model replaces it without changing anything else.
 */

export const LEXICAL_MODEL = 'lexical-v1';
export const LEXICAL_DIMENSIONS = 512;

function bucket(token: string, dimensions: number): number {
  const digest = createHash('sha1').update(token).digest();
  return digest.readUInt32BE(0) % dimensions;
}

function charGrams(text: string, size = 4): string[] {
  const padded = ` ${text} `;
  if (padded.length <= size) return [padded];
  const out: string[] = [];
  for (let i = 0; i <= padded.length - size; i += 1) out.push(padded.slice(i, i + size));
  return out;
}

export function lexicalEmbedding(text: string, dimensions = LEXICAL_DIMENSIONS): Float32Array {
  const vector = new Float32Array(dimensions);
  const normalised = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalised) return vector;

  const counts = new Map<string, number>();
  const add = (token: string): void => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  };

  for (const word of normalised.split(' ')) {
    if (word.length > 1) add(`w:${word}`);
  }
  for (const gram of charGrams(normalised)) add(`c:${gram}`);

  for (const [token, count] of counts) {
    // Sublinear scaling stops a repeated word from dominating the vector.
    const index = bucket(token, dimensions);
    vector[index] = (vector[index] ?? 0) + 1 + Math.log(count);
  }

  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i += 1) vector[i] = (vector[i] ?? 0) / magnitude;
  }

  return vector;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Vectors are stored as packed float32 so one schema serves every provider. */
export function packEmbedding(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function unpackEmbedding(buffer: Buffer): Float32Array {
  const copy = Buffer.from(buffer);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
