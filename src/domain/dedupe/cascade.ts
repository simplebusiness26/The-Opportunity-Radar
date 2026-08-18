import type { EvidenceClass } from '../taxonomy/evidence-class';
import { countsAsIndependent, isStrongerEvidence } from '../taxonomy/evidence-class';
import {
  containment,
  hammingDistance,
  simhashThresholdFor,
  textSimilarity,
  titleSimilarity,
  tokenize,
} from './fingerprint';
import { cosineSimilarity } from './embedding';

/**
 * The duplicate cascade.
 *
 * Three quantities are kept apart throughout the product, because conflating
 * them is how an opportunity engine fools itself:
 *
 *   raw mentions      -- every observation, however many times repeated
 *   unique evidence   -- distinct claims about the world
 *   independent sources -- unrelated parties who observed it
 *
 * One press release reprinted by forty outlets is forty mentions, one piece of
 * unique evidence, and one independent source. Only the last of those should
 * move confidence.
 */

export interface DedupeCandidate {
  id: string;
  canonicalUrl: string | null;
  externalId: string | null;
  sourceId: string;
  title: string;
  text: string;
  contentHash: string;
  simhash: bigint;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  entityKeys: string[];
  publishedAt: Date | null;
  evidenceClass: EvidenceClass;
  originKey: string | null;
  authorIdentityKey: string | null;
  /** Upstream URL this piece cites, when it is visibly derivative. */
  citesUrl: string | null;
}

export interface DedupeThresholds {
  /** Baseline for long documents; short ones widen it. See simhashThresholdFor. */
  simhashMaxDistance: number;
  /** Body-text overlap accepted as confirmation when titles were rewritten. */
  textSimilarity: number;
  titleSimilarity: number;
  /** Applied to real embeddings. */
  semanticSimilarity: number;
  /** Stricter, because lexical vectors match wording rather than meaning. */
  lexicalSimilarity: number;
  entityOverlap: number;
  temporalWindowDays: number;
  /** Fraction of a candidate found in an earlier item to call it syndication. */
  syndicationContainment: number;
}

export const DEFAULT_THRESHOLDS: DedupeThresholds = {
  simhashMaxDistance: 3,
  textSimilarity: 0.8,
  titleSimilarity: 0.72,
  semanticSimilarity: 0.9,
  lexicalSimilarity: 0.94,
  entityOverlap: 0.5,
  temporalWindowDays: 14,
  syndicationContainment: 0.6,
};

export type DedupeReason =
  | 'canonical_url'
  | 'content_hash'
  | 'source_external_id'
  | 'near_duplicate'
  | 'semantic'
  | 'syndication'
  | 'distinct';

export interface DedupeDecision {
  reason: DedupeReason;
  /** The evidence unit this belongs to, or null when it is genuinely new. */
  matchedId: string | null;
  /** How the candidate relates to the matched unit. */
  role: 'primary' | 'corroborating' | 'duplicate';
  /** Recorded on the signal so the decision can be explained and audited. */
  detail: Record<string, unknown>;
  confidence: number;
}

function daysBetween(a: Date | null, b: Date | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/**
 * Compares one candidate against already-known items, cheapest test first, and
 * stops at the first confident answer. Every outcome records why.
 */
export function classifyDuplicate(
  candidate: DedupeCandidate,
  existing: readonly DedupeCandidate[],
  thresholds: DedupeThresholds = DEFAULT_THRESHOLDS,
): DedupeDecision {
  for (const other of existing) {
    if (other.id === candidate.id) continue;

    if (candidate.canonicalUrl && candidate.canonicalUrl === other.canonicalUrl) {
      return {
        reason: 'canonical_url',
        matchedId: other.id,
        role: 'duplicate',
        detail: { canonicalUrl: candidate.canonicalUrl },
        confidence: 1,
      };
    }

    if (candidate.contentHash === other.contentHash) {
      return {
        reason: 'content_hash',
        matchedId: other.id,
        role: 'duplicate',
        detail: { contentHash: candidate.contentHash },
        confidence: 1,
      };
    }

    if (
      candidate.externalId &&
      candidate.externalId === other.externalId &&
      candidate.sourceId === other.sourceId
    ) {
      return {
        reason: 'source_external_id',
        matchedId: other.id,
        role: 'duplicate',
        detail: { sourceId: candidate.sourceId, externalId: candidate.externalId },
        confidence: 1,
      };
    }
  }

  const candidateTokens = tokenize(candidate.text).length;

  for (const other of existing) {
    if (other.id === candidate.id) continue;

    // The bar widens for short texts, where a single edited word moves many
    // bits, and narrows for long ones where it barely moves any.
    const allowed = Math.max(
      thresholds.simhashMaxDistance,
      simhashThresholdFor(Math.min(candidateTokens, tokenize(other.text).length)),
    );
    const distance = hammingDistance(candidate.simhash, other.simhash);
    if (distance > allowed) continue;

    // Simhash proximity alone is a prefilter, never a verdict. Reposts often
    // carry a rewritten headline, so either the title or the body must confirm.
    const titles = titleSimilarity(candidate.title, other.title);
    const bodies = textSimilarity(candidate.text, other.text);
    if (titles < thresholds.titleSimilarity && bodies < thresholds.textSimilarity) continue;

    return {
      reason: 'near_duplicate',
      matchedId: other.id,
      role: 'duplicate',
      detail: {
        simhashDistance: distance,
        allowedDistance: allowed,
        titleSimilarity: Number(titles.toFixed(3)),
        textSimilarity: Number(bodies.toFixed(3)),
      },
      confidence: titles >= thresholds.titleSimilarity && bodies >= thresholds.textSimilarity ? 0.95 : 0.85,
    };
  }

  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (!candidate.embedding || !other.embedding) continue;
    if (candidate.embeddingModel !== other.embeddingModel) continue;

    // Lexical vectors match wording rather than meaning, so they are held to a
    // stricter bar and the method used is always recorded.
    const isLexical = candidate.embeddingModel?.startsWith('lexical') ?? false;
    const required = isLexical ? thresholds.lexicalSimilarity : thresholds.semanticSimilarity;

    const similarity = cosineSimilarity(candidate.embedding, other.embedding);
    if (similarity < required) continue;

    const entityJaccard = overlap(candidate.entityKeys, other.entityKeys);
    if (entityJaccard < thresholds.entityOverlap) continue;
    if (daysBetween(candidate.publishedAt, other.publishedAt) > thresholds.temporalWindowDays) continue;

    return {
      reason: 'semantic',
      matchedId: other.id,
      role: 'duplicate',
      detail: {
        method: candidate.embeddingModel,
        similarity: Number(similarity.toFixed(3)),
        entityOverlap: Number(entityJaccard.toFixed(3)),
      },
      confidence: isLexical ? 0.7 : 0.85,
    };
  }

  for (const other of existing) {
    if (other.id === candidate.id) continue;

    const citesOther =
      candidate.citesUrl !== null && other.canonicalUrl !== null && candidate.citesUrl === other.canonicalUrl;
    const contained = containment(candidate.text, other.text);

    // Derivative material adds reach, not evidence, so it corroborates the
    // original rather than standing as a separate observation.
    if (citesOther || (contained >= thresholds.syndicationContainment && isStrongerEvidence(other.evidenceClass, candidate.evidenceClass))) {
      return {
        reason: 'syndication',
        matchedId: other.id,
        role: 'corroborating',
        detail: {
          citesUpstream: citesOther,
          containment: Number(contained.toFixed(3)),
          upstreamClass: other.evidenceClass,
        },
        confidence: citesOther ? 0.95 : 0.75,
      };
    }
  }

  return { reason: 'distinct', matchedId: null, role: 'primary', detail: {}, confidence: 1 };
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface EvidenceCounts {
  rawMentions: number;
  uniqueEvidence: number;
  independentSources: number;
  /** Normalised 0-1 spread across distinct origins. */
  sourceDiversity: number;
  /** Mentions excluded from independence because they are AI-derived. */
  aiDerivedMentions: number;
}

export interface CountableMention {
  evidenceUnitId: string;
  originKey: string | null;
  authorIdentityKey: string | null;
  evidenceClass: EvidenceClass;
}

/**
 * Turns a set of mentions into the three headline numbers.
 *
 * Identities collapse deliberately: the same author on two platforms is one
 * source, and declared affiliations fold outlets under common ownership
 * together. AI-derived material is counted and shown, but never contributes to
 * independence -- otherwise the system could manufacture its own corroboration.
 */
export function computeEvidenceCounts(
  mentions: readonly CountableMention[],
  affiliations: ReadonlyMap<string, string> = new Map(),
): EvidenceCounts {
  const evidenceUnits = new Set<string>();
  const origins = new Map<string, number>();
  let aiDerived = 0;

  for (const mention of mentions) {
    evidenceUnits.add(mention.evidenceUnitId);

    if (!countsAsIndependent(mention.evidenceClass)) {
      aiDerived += 1;
      continue;
    }

    const identity =
      mention.authorIdentityKey ??
      (mention.originKey ? (affiliations.get(mention.originKey) ?? mention.originKey) : null);
    if (!identity) continue;

    origins.set(identity, (origins.get(identity) ?? 0) + 1);
  }

  return {
    rawMentions: mentions.length,
    uniqueEvidence: evidenceUnits.size,
    independentSources: origins.size,
    sourceDiversity: shannonEvenness([...origins.values()]),
    aiDerivedMentions: aiDerived,
  };
}

/**
 * Normalised Shannon entropy. One source dominating scores near zero even when
 * the raw count is high, which is what distinguishes broad corroboration from
 * one loud voice.
 */
export function shannonEvenness(counts: readonly number[]): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0 || counts.length <= 1) return counts.length === 1 ? 1 : 0;

  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  return entropy / Math.log(counts.length);
}
