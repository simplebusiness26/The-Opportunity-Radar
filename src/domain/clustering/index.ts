import { countsAsIndependent, evidenceWeight } from '../taxonomy/evidence-class';
import type { EvidenceClass } from '../taxonomy/evidence-class';
import { cosineSimilarity, LEXICAL_MODEL } from '../dedupe/embedding';
import { jaccard, textSimilarity } from '../dedupe/fingerprint';
import { NO_INDEPENDENT_SOURCE_CEILING, SINGLE_SOURCE_CEILING } from '../scoring/confidence';

/**
 * Clustering turns distinct pieces of evidence into the underlying problem they
 * are all about.
 *
 * A single complaint is not a market. The cluster is where "several unrelated
 * parties independently hit this" becomes visible, which is why its metrics are
 * about *independence and diversity*, not volume. A cluster of forty mentions
 * from one origin is weaker than a cluster of four from four.
 */

export interface ClusterableEvidence {
  id: string;
  /** The one-line claim, as shown to a person. */
  claimText: string;
  /**
   * The text similarity is computed over: the claim plus the body of the signal
   * behind it. A claim alone is usually a headline, and headlines are too thin
   * to group on -- two descriptions of the same problem often share no words at
   * all until you read past the title.
   */
  matchText: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  entityKeys: string[];
  evidenceClass: EvidenceClass;
  originKeys: string[];
  mentionCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Time-decayed strength at the moment of computation. */
  strength: number;
}

export interface ClusterAssignment {
  evidenceUnitId: string;
  similarity: number;
  method: 'semantic' | 'lexical' | 'entity' | 'manual';
}

export interface ClusterMatch {
  clusterId: string;
  similarity: number;
  method: ClusterAssignment['method'];
}

export interface ClusterCentroid {
  clusterId: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  title: string;
  problemStatement: string;
  entityKeys: string[];
}

export interface ClusteringThresholds {
  /**
   * Cosine similarity needed to join on embeddings, for a real embedding model.
   * `lexical-v1` uses its own, much lower scale -- see joinThresholdFor.
   */
  semanticJoin: number;
  /**
   * Threshold for `lexical-v1` vectors, which live on a different scale: hashed
   * word overlap puts paraphrases around 0.35-0.50 and unrelated text below
   * 0.20, where a real embedding model would put paraphrases above 0.85.
   * Measured on representative pairs; see tests/unit/clustering.test.ts.
   */
  lexicalVectorJoin: number;
  /**
   * Minimum shared-token overlap required alongside a `lexical-v1` cosine match.
   *
   * Hashed lexical vectors drift upwards with document length: two unrelated
   * paragraphs score around 0.30 where two related ones score around 0.52, a
   * gap too narrow to trust on its own. Token overlap separates the same pairs
   * by an order of magnitude (0.03 against 0.27), so the lexical path requires
   * both. Measured in tests/unit/clustering.test.ts.
   */
  lexicalSupportFloor: number;
  /** Whole-text fallback, deliberately stricter: it is a coarser signal. */
  lexicalJoin: number;
  /** Entity overlap (Jaccard) that alone justifies a join. */
  entityJoin: number;
  /** Unique evidence needed before a cluster is worth a human's attention. */
  minUniqueEvidence: number;
  /** Independent origins needed before a cluster may be promoted. */
  minIndependentSources: number;
}

export const DEFAULT_CLUSTERING: ClusteringThresholds = {
  semanticJoin: 0.62,
  lexicalVectorJoin: 0.45,
  lexicalSupportFloor: 0.12,
  lexicalJoin: 0.72,
  entityJoin: 0.6,
  minUniqueEvidence: 3,
  minIndependentSources: 2,
};

/**
 * Embedding similarity is not comparable across models, so the bar depends on
 * which produced the vectors. Without an embedding provider Radar uses
 * `lexical-v1`, whose scale is far more compressed; treating it as if it were a
 * semantic model would either join everything or nothing.
 */
export function joinThresholdFor(
  embeddingModel: string | null,
  thresholds: ClusteringThresholds,
): number {
  return embeddingModel === LEXICAL_MODEL ? thresholds.lexicalVectorJoin : thresholds.semanticJoin;
}

/**
 * Finds the cluster a piece of evidence belongs to, if any.
 *
 * Embeddings are tried first, then lexical similarity, then shared entities.
 * The method that produced the match is returned and recorded, so the interface
 * never claims semantic grouping when only word overlap was available -- which
 * matters, because without an embedding provider the vectors are lexical.
 */
export function findCluster(
  evidence: ClusterableEvidence,
  centroids: readonly ClusterCentroid[],
  thresholds: ClusteringThresholds = DEFAULT_CLUSTERING,
): ClusterMatch | null {
  let best: ClusterMatch | null = null;

  const consider = (candidate: ClusterMatch): void => {
    if (!best || candidate.similarity > best.similarity) best = candidate;
  };

  for (const centroid of centroids) {
    const centroidText = `${centroid.title} ${centroid.problemStatement}`;

    if (
      evidence.embedding &&
      centroid.embedding &&
      evidence.embeddingModel === centroid.embeddingModel
    ) {
      const similarity = cosineSimilarity(evidence.embedding, centroid.embedding);

      // A lexical vector is corroborated by token overlap before it is trusted;
      // a real embedding model needs no such crutch. Without a provider this
      // means genuine paraphrases that share no vocabulary are missed -- an
      // honest limitation, and the clearest reason to connect an embedding
      // model. See docs/SIGNAL_ENGINE.md.
      const supported =
        evidence.embeddingModel !== LEXICAL_MODEL ||
        textSimilarity(evidence.matchText, centroidText) >= thresholds.lexicalSupportFloor;

      if (similarity >= joinThresholdFor(evidence.embeddingModel, thresholds) && supported) {
        consider({ clusterId: centroid.clusterId, similarity, method: 'semantic' });
        continue;
      }
    }

    const lexical = textSimilarity(evidence.matchText, centroidText);
    if (lexical >= thresholds.lexicalJoin) {
      consider({ clusterId: centroid.clusterId, similarity: lexical, method: 'lexical' });
      continue;
    }

    const entityOverlap =
      evidence.entityKeys.length && centroid.entityKeys.length
        ? jaccard(evidence.entityKeys, centroid.entityKeys)
        : 0;
    if (entityOverlap >= thresholds.entityJoin) {
      consider({ clusterId: centroid.clusterId, similarity: entityOverlap, method: 'entity' });
    }
  }

  return best;
}

export interface ClusterMetrics {
  rawMentions: number;
  uniqueEvidenceCount: number;
  /**
   * Unique evidence excluding AI-derived restatements. Confidence is computed
   * from this, never from the total: a model paraphrasing a claim is not a
   * second observation of it.
   */
  independentEvidenceCount: number;
  independentSourceCount: number;
  /** Normalised Shannon entropy over origins, weighted by evidence class. */
  sourceDiversity: number;
  /** Evidence added in the last 30 days as a share of the total, decay-weighted. */
  momentum30d: number | null;
  firstSeenAt: Date | null;
  lastEvidenceAt: Date | null;
  /** Aggregate decayed strength across members. */
  totalStrength: number;
}

/**
 * Recomputes a cluster's headline numbers from its members.
 *
 * AI-derived evidence is counted as evidence but never as an *independent
 * source*: a model restating a claim is not a second party observing it. That
 * rule is what stops the system inflating its own confidence.
 */
export function computeClusterMetrics(
  members: readonly ClusterableEvidence[],
  now: Date,
): ClusterMetrics {
  if (members.length === 0) {
    return {
      rawMentions: 0,
      uniqueEvidenceCount: 0,
      independentEvidenceCount: 0,
      independentSourceCount: 0,
      sourceDiversity: 0,
      momentum30d: null,
      firstSeenAt: null,
      lastEvidenceAt: null,
      totalStrength: 0,
    };
  }

  let rawMentions = 0;
  let totalStrength = 0;
  let firstSeenAt = members[0]!.firstSeenAt;
  let lastEvidenceAt = members[0]!.lastSeenAt;

  const independentOrigins = new Set<string>();
  const originWeight = new Map<string, number>();
  let independentEvidenceCount = 0;

  for (const member of members) {
    rawMentions += Math.max(1, member.mentionCount);
    totalStrength += member.strength;
    if (member.firstSeenAt < firstSeenAt) firstSeenAt = member.firstSeenAt;
    if (member.lastSeenAt > lastEvidenceAt) lastEvidenceAt = member.lastSeenAt;

    // Diversity is measured over independent origins only. Counting AI-derived
    // rows here would let the system manufacture its own source spread.
    if (!countsAsIndependent(member.evidenceClass)) continue;

    independentEvidenceCount += 1;
    const weight = evidenceWeight(member.evidenceClass);
    for (const origin of member.originKeys) {
      originWeight.set(origin, (originWeight.get(origin) ?? 0) + weight);
      independentOrigins.add(origin);
    }
  }

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentStrength = members
    .filter((member) => member.lastSeenAt >= thirtyDaysAgo)
    .reduce((total, member) => total + member.strength, 0);

  return {
    rawMentions,
    uniqueEvidenceCount: members.length,
    independentEvidenceCount,
    independentSourceCount: independentOrigins.size,
    sourceDiversity: shannonDiversity([...originWeight.values()]),
    momentum30d: totalStrength > 0 ? recentStrength / totalStrength : null,
    firstSeenAt,
    lastEvidenceAt,
    totalStrength,
  };
}

/**
 * Normalised Shannon entropy: 0 when everything came from one origin, 1 when
 * evidence is spread evenly across origins. A single origin scores zero however
 * loud it is.
 */
export function shannonDiversity(weights: readonly number[]): number {
  const positive = weights.filter((weight) => weight > 0);
  if (positive.length <= 1) return 0;

  const total = positive.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;

  let entropy = 0;
  for (const weight of positive) {
    const share = weight / total;
    entropy -= share * Math.log(share);
  }
  return entropy / Math.log(positive.length);
}

/**
 * Confidence that the cluster describes a real, recurring problem.
 *
 * This is confidence in the *pattern*, not in any thesis about what to build
 * about it -- that is scored separately on the opportunity. It obeys the same
 * ceilings: without independent non-AI corroboration, repetition alone cannot
 * buy certainty, however much of it there is.
 */
export function computeClusterConfidence(metrics: ClusterMetrics): number {
  if (metrics.uniqueEvidenceCount === 0) return 0;
  if (metrics.independentEvidenceCount === 0) return NO_INDEPENDENT_SOURCE_CEILING * 0.5;

  if (metrics.independentSourceCount === 0) return NO_INDEPENDENT_SOURCE_CEILING * 0.5;

  // Saturating in the number of independent sources: the second source is worth
  // far more than the tenth.
  const breadth = 1 - Math.exp(-metrics.independentSourceCount / 3);
  const depth = 1 - Math.exp(-metrics.independentEvidenceCount / 5);
  const diversity = metrics.sourceDiversity;

  const value = 0.45 * breadth + 0.3 * depth + 0.25 * diversity;

  return metrics.independentSourceCount === 1
    ? Math.min(value, SINGLE_SOURCE_CEILING)
    : Math.min(value, 0.95);
}

export type ClusterReadiness =
  | { ready: true }
  | { ready: false; reason: string; missing: { uniqueEvidence: number; independentSources: number } };

/**
 * Whether a cluster has earned investigation. Deliberately conservative: the
 * expensive stages downstream exist to be protected from noise.
 */
export function assessClusterReadiness(
  metrics: ClusterMetrics,
  thresholds: ClusteringThresholds = DEFAULT_CLUSTERING,
): ClusterReadiness {
  const missingEvidence = Math.max(0, thresholds.minUniqueEvidence - metrics.uniqueEvidenceCount);
  const missingSources = Math.max(
    0,
    thresholds.minIndependentSources - metrics.independentSourceCount,
  );

  if (missingEvidence === 0 && missingSources === 0) return { ready: true };

  const parts: string[] = [];
  if (missingEvidence > 0) parts.push(`${missingEvidence} more unique piece(s) of evidence`);
  if (missingSources > 0) parts.push(`${missingSources} more independent source(s)`);

  return {
    ready: false,
    reason: `Needs ${parts.join(' and ')} before it is worth investigating.`,
    missing: { uniqueEvidence: missingEvidence, independentSources: missingSources },
  };
}
