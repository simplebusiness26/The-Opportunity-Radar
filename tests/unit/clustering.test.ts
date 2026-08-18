import { describe, expect, it } from 'vitest';
import {
  assessClusterReadiness,
  computeClusterConfidence,
  computeClusterMetrics,
  DEFAULT_CLUSTERING,
  findCluster,
  shannonDiversity,
} from '../../src/domain/clustering/index';
import type { ClusterableEvidence, ClusterCentroid } from '../../src/domain/clustering/index';
import { cosineSimilarity, lexicalEmbedding, LEXICAL_MODEL } from '../../src/domain/dedupe/embedding';
import { textSimilarity } from '../../src/domain/dedupe/fingerprint';
import { joinThresholdFor } from '../../src/domain/clustering/index';
import type { EvidenceClass } from '../../src/domain/taxonomy/evidence-class';

const NOW = new Date('2026-08-18T00:00:00Z');

function evidence(overrides: Partial<ClusterableEvidence> = {}): ClusterableEvidence {
  const claimText = overrides.claimText ?? 'Restaurants lose money when diners fail to turn up';
  return {
    id: overrides.id ?? 'e1',
    claimText,
    matchText: overrides.matchText ?? claimText,
    embedding: overrides.embedding ?? null,
    embeddingModel: overrides.embeddingModel ?? null,
    entityKeys: overrides.entityKeys ?? [],
    evidenceClass: overrides.evidenceClass ?? 'direct_customer',
    originKeys: overrides.originKeys ?? ['example.com'],
    mentionCount: overrides.mentionCount ?? 1,
    firstSeenAt: overrides.firstSeenAt ?? NOW,
    lastSeenAt: overrides.lastSeenAt ?? NOW,
    strength: overrides.strength ?? 1,
  };
}

function centroid(overrides: Partial<ClusterCentroid> = {}): ClusterCentroid {
  return {
    clusterId: overrides.clusterId ?? 'c1',
    embedding: overrides.embedding ?? null,
    embeddingModel: overrides.embeddingModel ?? null,
    title: overrides.title ?? 'Restaurant no-shows',
    problemStatement:
      overrides.problemStatement ?? 'Restaurants lose covers when diners do not turn up',
    entityKeys: overrides.entityKeys ?? [],
  };
}

describe('finding the cluster a piece of evidence belongs to', () => {
  it('matches on embeddings when both sides have a comparable vector', () => {
    const text =
      'Diners book a table and never arrive, and the restaurant eats the cost of the covers it turned away';
    const match = findCluster(
      evidence({ claimText: text, embedding: lexicalEmbedding(text), embeddingModel: LEXICAL_MODEL }),
      [
        centroid({
          title: 'Restaurant no-shows',
          problemStatement:
            'Restaurants lose covers and eat the cost when diners book a table and never arrive',
          embedding: lexicalEmbedding(
            'Restaurants lose covers and eat the cost when diners book a table and never arrive',
          ),
          embeddingModel: LEXICAL_MODEL,
        }),
      ],
    );

    expect(match?.clusterId).toBe('c1');
    expect(match?.method).toBe('semantic');
  });

  it('does not claim a semantic match when the vectors came from different models', () => {
    const text = 'Diners book a table and never arrive';
    const match = findCluster(
      evidence({ claimText: text, embedding: lexicalEmbedding(text), embeddingModel: 'openai-v3' }),
      [
        centroid({
          title: 'Something else entirely',
          problemStatement: 'Warehouse routing costs',
          embedding: lexicalEmbedding(text),
          embeddingModel: LEXICAL_MODEL,
        }),
      ],
    );

    // Comparing vectors across models would be meaningless, so it must fall
    // through to the textual paths and find nothing.
    expect(match).toBeNull();
  });

  it('falls back to shared entities when the wording has nothing in common', () => {
    const match = findCluster(
      evidence({
        claimText: 'Completely different phrasing about scheduling overheads',
        entityKeys: ['opentable', 'resy', 'sevenrooms'],
      }),
      [centroid({ entityKeys: ['opentable', 'resy', 'sevenrooms', 'tock'] })],
    );

    expect(match?.method).toBe('entity');
  });

  it('returns nothing rather than forcing a weak match', () => {
    expect(
      findCluster(
        evidence({ claimText: 'Freight forwarders cannot get customs paperwork right' }),
        [centroid()],
      ),
    ).toBeNull();
  });
});

describe('cluster metrics', () => {
  it('keeps mentions, unique evidence and independent sources apart', () => {
    const metrics = computeClusterMetrics(
      [
        evidence({ id: 'a', originKeys: ['bbc.co.uk'], mentionCount: 40 }),
        evidence({ id: 'b', originKeys: ['reddit.com'], mentionCount: 1 }),
      ],
      NOW,
    );

    // Forty reprints of one story is forty mentions and one source.
    expect(metrics.rawMentions).toBe(41);
    expect(metrics.uniqueEvidenceCount).toBe(2);
    expect(metrics.independentSourceCount).toBe(2);
  });

  it('never counts AI-derived evidence as an independent source', () => {
    const human = computeClusterMetrics([evidence({ id: 'a', originKeys: ['forum.example'] })], NOW);

    const withMachines = computeClusterMetrics(
      [
        evidence({ id: 'a', originKeys: ['forum.example'] }),
        ...Array.from({ length: 50 }, (_, index) =>
          evidence({
            id: `ai-${index}`,
            evidenceClass: 'ai_derived' as EvidenceClass,
            originKeys: [`model-run-${index}`],
          }),
        ),
      ],
      NOW,
    );

    expect(withMachines.independentSourceCount).toBe(human.independentSourceCount);
    expect(computeClusterConfidence(withMachines)).toBeLessThanOrEqual(
      computeClusterConfidence(human) + 1e-9,
    );
  });

  it('scores a single loud origin as zero diversity', () => {
    const metrics = computeClusterMetrics(
      [
        evidence({ id: 'a', originKeys: ['loud.example'], mentionCount: 500 }),
        evidence({ id: 'b', originKeys: ['loud.example'], mentionCount: 500 }),
      ],
      NOW,
    );

    expect(metrics.sourceDiversity).toBe(0);
    expect(metrics.independentSourceCount).toBe(1);
  });

  it('reports momentum as the recent share of decayed strength', () => {
    const old = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000);
    const metrics = computeClusterMetrics(
      [
        evidence({ id: 'old', firstSeenAt: old, lastSeenAt: old, strength: 1 }),
        evidence({ id: 'new', strength: 3 }),
      ],
      NOW,
    );

    expect(metrics.momentum30d).toBeCloseTo(0.75, 5);
  });

  it('returns an empty, honest shape for a cluster with no members', () => {
    const metrics = computeClusterMetrics([], NOW);
    expect(metrics.uniqueEvidenceCount).toBe(0);
    expect(metrics.momentum30d).toBeNull();
    expect(metrics.firstSeenAt).toBeNull();
  });
});

describe('shannon diversity', () => {
  it('is zero for one origin and one for a perfectly even spread', () => {
    expect(shannonDiversity([5])).toBe(0);
    expect(shannonDiversity([1, 1, 1, 1])).toBeCloseTo(1, 6);
  });

  it('falls as the distribution concentrates', () => {
    expect(shannonDiversity([100, 1, 1])).toBeLessThan(shannonDiversity([10, 8, 9]));
  });
});

describe('cluster confidence', () => {
  it('cannot exceed the no-source ceiling without an independent source', () => {
    const metrics = computeClusterMetrics(
      Array.from({ length: 30 }, (_, index) =>
        evidence({ id: `x${index}`, evidenceClass: 'ai_derived', originKeys: ['model'] }),
      ),
      NOW,
    );
    expect(computeClusterConfidence(metrics)).toBeLessThanOrEqual(0.15);
  });

  it('is capped while only one independent source has been seen', () => {
    const metrics = computeClusterMetrics(
      Array.from({ length: 20 }, (_, index) => evidence({ id: `x${index}`, originKeys: ['one.example'] })),
      NOW,
    );
    expect(computeClusterConfidence(metrics)).toBeLessThanOrEqual(0.45);
  });

  it('rises with genuinely independent corroboration', () => {
    const metrics = computeClusterMetrics(
      Array.from({ length: 8 }, (_, index) =>
        evidence({ id: `x${index}`, originKeys: [`origin-${index}.example`] }),
      ),
      NOW,
    );
    expect(computeClusterConfidence(metrics)).toBeGreaterThan(0.6);
  });
});

describe('readiness for investigation', () => {
  it('withholds a thin cluster and says exactly what is missing', () => {
    const readiness = assessClusterReadiness(
      computeClusterMetrics([evidence()], NOW),
      DEFAULT_CLUSTERING,
    );

    expect(readiness.ready).toBe(false);
    if (!readiness.ready) {
      expect(readiness.missing.uniqueEvidence).toBe(2);
      expect(readiness.missing.independentSources).toBe(1);
      expect(readiness.reason).toContain('unique piece');
    }
  });

  it('passes a cluster with enough independent corroboration', () => {
    const readiness = assessClusterReadiness(
      computeClusterMetrics(
        [
          evidence({ id: 'a', originKeys: ['a.example'] }),
          evidence({ id: 'b', originKeys: ['b.example'] }),
          evidence({ id: 'c', originKeys: ['c.example'] }),
        ],
        NOW,
      ),
    );
    expect(readiness.ready).toBe(true);
  });
});


/**
 * The join thresholds are measured properties of the embedding model, not taste.
 *
 * These fixtures are the length Radar actually compares -- a claim plus the body
 * of the signal behind it -- because hashed lexical vectors drift upwards with
 * document length, and calibrating on short sentences would set the bar in the
 * wrong place.
 */
describe('the lexical scale the thresholds are calibrated against', () => {
  const centroidText =
    'Restaurant no-shows Restaurants lose covers when diners book a table and never turn up, and cannot take a deposit.';

  const related = [
    'Booking tool that charges a deposit Looking for a restaurant booking tool that charges a deposit up front so diners who book a table actually turn up. Losing covers every week.',
    'Reservations administrator wanted Hiring a reservations administrator to chase diners who book a table and never turn up, and to handle deposit taking for covers we would otherwise lose.',
  ];

  const unrelated = [
    'Customs paperwork errors Freight forwarders keep getting customs declarations wrong and shipments sit at the port for days waiting for corrected paperwork.',
    'Kubernetes operator complexity Platform teams find writing custom Kubernetes operators error prone and hard to test in realistic clusters.',
    'Solar inverter supply Installers cannot source inverters and jobs are delayed for weeks waiting on distributor stock.',
  ];

  const cosine = (text: string): number =>
    cosineSimilarity(lexicalEmbedding(centroidText), lexicalEmbedding(text));

  const vectorBar = joinThresholdFor(LEXICAL_MODEL, DEFAULT_CLUSTERING);

  it('separates related from unrelated on cosine, but only narrowly', () => {
    for (const text of related) expect(cosine(text)).toBeGreaterThan(vectorBar);
    for (const text of unrelated) expect(cosine(text)).toBeLessThan(vectorBar);

    // The margin is thin, which is exactly why the lexical path also requires
    // token support. Guarding the gap here means a change that narrows it fails
    // loudly rather than quietly merging unrelated problems.
    const worstRelated = Math.min(...related.map(cosine));
    const bestUnrelated = Math.max(...unrelated.map(cosine));
    expect(worstRelated - bestUnrelated).toBeGreaterThan(0.15);
  });

  it('separates them far more decisively on shared tokens', () => {
    const floor = DEFAULT_CLUSTERING.lexicalSupportFloor;
    for (const text of related) expect(textSimilarity(centroidText, text)).toBeGreaterThan(floor);
    for (const text of unrelated) expect(textSimilarity(centroidText, text)).toBeLessThan(floor);
  });

  it('requires token support before trusting a lexical vector match', () => {
    // An unrelated problem whose vector happens to score highly must still be
    // refused, because no meaningful vocabulary is shared.
    const impostor = unrelated[0]!;
    const match = findCluster(
      evidence({
        claimText: impostor,
        matchText: impostor,
        embedding: lexicalEmbedding(centroidText),
        embeddingModel: LEXICAL_MODEL,
      }),
      [
        centroid({
          title: 'Restaurant no-shows',
          problemStatement:
            'Restaurants lose covers when diners book a table and never turn up, and cannot take a deposit.',
          embedding: lexicalEmbedding(centroidText),
          embeddingModel: LEXICAL_MODEL,
        }),
      ],
    );
    expect(match).toBeNull();
  });

  it('uses a higher bar for a real embedding model', () => {
    expect(joinThresholdFor('openai-text-embedding-3-small', DEFAULT_CLUSTERING)).toBeGreaterThan(
      vectorBar,
    );
  });
});
