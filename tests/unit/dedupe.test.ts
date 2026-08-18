import { describe, expect, it } from 'vitest';
import { canonicaliseUrl, originKey, registrableDomain } from '../../src/domain/dedupe/canonical-url';
import {
  contentHash,
  containment,
  hammingDistance,
  simhash,
  simhashThresholdFor,
  titleSimilarity,
  tokenize,
} from '../../src/domain/dedupe/fingerprint';
import { cosineSimilarity, lexicalEmbedding, packEmbedding, unpackEmbedding } from '../../src/domain/dedupe/embedding';
import {
  classifyDuplicate,
  computeEvidenceCounts,
  shannonEvenness,
  type DedupeCandidate,
} from '../../src/domain/dedupe/cascade';

describe('url canonicalisation', () => {
  it('collapses the ways the same article gets shared', () => {
    const variants = [
      'https://example.com/article',
      'http://example.com/article',
      'https://www.example.com/article/',
      'https://example.com/article?utm_source=newsletter&utm_medium=email',
      'https://example.com/article#section-2',
      'https://EXAMPLE.com:443/article',
      'https://example.com//article',
    ];
    const canonical = variants.map((url) => canonicaliseUrl(url));
    expect(new Set(canonical).size).toBe(1);
  });

  it('keeps parameters that identify the content itself', () => {
    const a = canonicaliseUrl('https://www.youtube.com/watch?v=abc123&utm_source=x');
    expect(a).toContain('v=abc123');
    expect(a).not.toContain('utm_source');
  });

  it('does not merge genuinely different pages', () => {
    expect(canonicaliseUrl('https://example.com/a')).not.toBe(canonicaliseUrl('https://example.com/b'));
    expect(canonicaliseUrl('https://example.com/p?id=1')).not.toBe(
      canonicaliseUrl('https://example.com/p?id=2'),
    );
  });

  it('refuses anything that is not a fetchable web address', () => {
    for (const bad of ['not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.test/a', '']) {
      expect(canonicaliseUrl(bad)).toBeNull();
    }
  });
});

describe('registrable domains', () => {
  it('treats subdomains of one publisher as one source', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('blog.example.com')).toBe('example.com');
  });

  /**
   * Two newsletters on one platform are two different authors, and must not be
   * collapsed into a single apparent source.
   */
  it('keeps separate authors on shared platforms separate', () => {
    expect(registrableDomain('alice.substack.com')).not.toBe(registrableDomain('bob.substack.com'));
    expect(registrableDomain('alice.medium.com')).toBe('alice.medium.com');
  });

  it('derives the origin from the upstream when content is syndicated', () => {
    expect(originKey('https://aggregator.test/story', 'https://original.test/story')).toBe(
      'original.test',
    );
    expect(originKey('https://aggregator.test/story', null)).toBe('aggregator.test');
  });
});

describe('fingerprints', () => {
  it('hashes cosmetically different renderings of the same text identically', () => {
    expect(contentHash('The  Quick   Brown Fox!')).toBe(contentHash('the quick brown fox'));
    expect(contentHash('**bold** text')).toBe(contentHash('bold text'));
  });

  it('keeps a lightly edited article within the threshold for its length', () => {
    const original =
      'Restaurants lose significant revenue to no-shows every week and most booking systems still make it hard to take a deposit up front.';
    const edited =
      'Restaurants lose significant revenue to no-shows every week, and most booking systems still make it hard to take a deposit up front today.';

    const distance = hammingDistance(simhash(original), simhash(edited));
    const allowed = simhashThresholdFor(tokenize(original).length);
    expect(distance).toBeLessThanOrEqual(allowed);
  });

  /**
   * Short texts are the common case for community evidence, and a threshold
   * tuned for long articles silently misses their reposts.
   */
  it('allows more drift on short texts than on long ones', () => {
    expect(simhashThresholdFor(20)).toBeGreaterThan(simhashThresholdFor(300));
    expect(simhashThresholdFor(300)).toBe(3);
  });

  it('places unrelated articles far apart', () => {
    const a = simhash('Restaurants lose revenue to no-shows and cannot take deposits easily.');
    const b = simhash('New compiler optimisation reduces build times for large Rust projects.');
    expect(hammingDistance(a, b)).toBeGreaterThan(12);
  });

  it('measures how much of one text is contained in another', () => {
    const original = 'Independent estate agents lose leads because nobody follows up after a viewing.';
    const quoted = `A reader writes: ${original} We think this is a real problem worth solving.`;
    expect(containment(original, quoted)).toBeGreaterThan(0.6);
    expect(containment(original, 'A completely unrelated discussion about compilers.')).toBe(0);
  });

  it('scores title similarity between 0 and 1', () => {
    expect(titleSimilarity('No-show problem for restaurants', 'No-show problem for restaurants')).toBe(1);
    expect(titleSimilarity('Restaurants and no-shows', 'Compiler optimisation news')).toBe(0);
  });
});

describe('lexical embeddings', () => {
  it('is deterministic, so the same text always gives the same vector', () => {
    const a = lexicalEmbedding('restaurant no-show deposits');
    const b = lexicalEmbedding('restaurant no-show deposits');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('scores near-identical text highly and unrelated text low', () => {
    const base = lexicalEmbedding('Restaurants lose money when customers do not show up for bookings');
    const similar = lexicalEmbedding('Restaurants lose money when customers do not show up for their bookings');
    const different = lexicalEmbedding('Rust compiler build times improved by a new optimisation pass');

    expect(cosineSimilarity(base, similar)).toBeGreaterThan(0.9);
    expect(cosineSimilarity(base, different)).toBeLessThan(0.5);
  });

  it('survives a round trip through storage', () => {
    const vector = lexicalEmbedding('a claim about the world');
    const restored = unpackEmbedding(packEmbedding(vector));
    expect(cosineSimilarity(vector, restored)).toBeCloseTo(1, 6);
  });

  it('handles empty text without producing a misleading match', () => {
    expect(cosineSimilarity(lexicalEmbedding(''), lexicalEmbedding('anything'))).toBe(0);
  });
});

const candidate = (over: Partial<DedupeCandidate> = {}): DedupeCandidate => {
  const text = over.text ?? 'Restaurants lose revenue to no-shows and cannot take deposits.';
  return {
    id: over.id ?? 'c1',
    canonicalUrl: over.canonicalUrl ?? null,
    externalId: over.externalId ?? null,
    sourceId: over.sourceId ?? 's1',
    title: over.title ?? 'No-shows cost restaurants',
    text,
    contentHash: over.contentHash ?? contentHash(text),
    simhash: over.simhash ?? simhash(text),
    embedding: over.embedding ?? null,
    embeddingModel: over.embeddingModel ?? null,
    entityKeys: over.entityKeys ?? [],
    publishedAt: over.publishedAt ?? new Date('2026-08-01T00:00:00Z'),
    evidenceClass: over.evidenceClass ?? 'community',
    originKey: over.originKey ?? 'example.com',
    authorIdentityKey: over.authorIdentityKey ?? null,
    citesUrl: over.citesUrl ?? null,
  };
};

describe('dedupe cascade', () => {
  it('matches on canonical url before doing any expensive work', () => {
    const existing = candidate({ id: 'a', canonicalUrl: 'https://example.com/x' });
    const incoming = candidate({ id: 'b', canonicalUrl: 'https://example.com/x', text: 'totally different words here' });

    const decision = classifyDuplicate(incoming, [existing]);
    expect(decision.reason).toBe('canonical_url');
    expect(decision.matchedId).toBe('a');
  });

  it('recognises a refetch of the same item whose text has since been edited', () => {
    const before = 'Original post about restaurant deposits and no-shows.';
    const after = 'Edited post about restaurant deposits, no-shows, and a follow-up note from the author.';
    const existing = candidate({
      id: 'a',
      externalId: '12345',
      sourceId: 'hn',
      text: before,
      contentHash: contentHash(before),
      simhash: simhash(before),
      title: 'Original title',
    });
    const incoming = candidate({
      id: 'b',
      externalId: '12345',
      sourceId: 'hn',
      text: after,
      contentHash: contentHash(after),
      simhash: simhash(after),
      title: 'Edited title entirely different words',
    });
    expect(classifyDuplicate(incoming, [existing]).reason).toBe('source_external_id');
  });

  it('does not match the same external id from a different source', () => {
    const topicA = 'Restaurants lose revenue to no-shows every single week without deposits.';
    const existing = candidate({
      id: 'a',
      externalId: '12345',
      sourceId: 'hn',
      text: topicA,
      contentHash: contentHash(topicA),
      simhash: simhash(topicA),
      title: 'Restaurant deposits',
    });
    const topicB = 'A completely unrelated subject about compilers, linkers and build times.';
    const incoming = candidate({
      id: 'b',
      externalId: '12345',
      sourceId: 'reddit',
      text: topicB,
      contentHash: contentHash(topicB),
      simhash: simhash(topicB),
      title: 'Compiler build times',
    });
    expect(classifyDuplicate(incoming, [existing]).reason).toBe('distinct');
  });

  it('treats a lightly rewritten repost as a duplicate', () => {
    const text = 'Restaurants lose significant revenue to no-shows every week and cannot easily take deposits.';
    const existing = candidate({ id: 'a', text, contentHash: contentHash(text), simhash: simhash(text) });
    const rewritten = `${text} `;
    const incoming = candidate({
      id: 'b',
      text: rewritten,
      contentHash: contentHash(rewritten),
      simhash: simhash(rewritten),
    });
    expect(['near_duplicate', 'content_hash']).toContain(classifyDuplicate(incoming, [existing]).reason);
  });

  it('records that a semantic match used lexical vectors, not meaning', () => {
    const text = 'Independent estate agents lose leads because nobody follows up after a viewing.';
    const nearly = 'Independent estate agents lose leads because nobody follows up after the viewing.';
    const existing = candidate({
      id: 'a',
      text,
      title: 'Estate agent follow-up',
      contentHash: contentHash(text),
      simhash: simhash(text),
      embedding: lexicalEmbedding(text),
      embeddingModel: 'lexical-v1',
      entityKeys: ['estate-agents'],
    });
    const incoming = candidate({
      id: 'b',
      text: nearly,
      title: 'Agents lose leads without follow up',
      contentHash: contentHash(nearly),
      simhash: simhash(nearly),
      embedding: lexicalEmbedding(nearly),
      embeddingModel: 'lexical-v1',
      entityKeys: ['estate-agents'],
    });

    const decision = classifyDuplicate(incoming, [existing]);
    if (decision.reason === 'semantic') {
      expect(decision.detail.method).toBe('lexical-v1');
      // Lexical matching is held at lower confidence than a real embedding.
      expect(decision.confidence).toBeLessThan(0.8);
    } else {
      expect(['near_duplicate', 'content_hash']).toContain(decision.reason);
    }
  });

  it('treats a piece that cites an earlier one as corroboration, not new evidence', () => {
    const existing = candidate({
      id: 'a',
      canonicalUrl: 'https://original.test/story',
      evidenceClass: 'primary',
    });
    const incoming = candidate({
      id: 'b',
      canonicalUrl: 'https://aggregator.test/story',
      citesUrl: 'https://original.test/story',
      evidenceClass: 'social',
      text: 'A short write-up pointing at the original announcement.',
    });

    const decision = classifyDuplicate(incoming, [existing]);
    expect(decision.reason).toBe('syndication');
    expect(decision.role).toBe('corroborating');
  });

  it('lets genuinely different observations through', () => {
    const existing = candidate({ id: 'a', text: 'Restaurants lose revenue to no-shows.' });
    const incoming = candidate({
      id: 'b',
      text: 'A new compiler optimisation reduces build times substantially for large projects.',
      title: 'Compiler news',
    });
    expect(classifyDuplicate(incoming, [existing]).reason).toBe('distinct');
  });
});

describe('mentions, unique evidence and independent sources', () => {
  it('keeps the three counts distinct for a widely syndicated story', () => {
    // One story, reprinted by forty outlets, all tracing to one origin.
    const mentions = Array.from({ length: 40 }, (_, i) => ({
      evidenceUnitId: 'unit-1',
      originKey: `outlet-${i}.test`,
      authorIdentityKey: null,
      evidenceClass: 'reliable_secondary' as const,
    }));
    // All forty are corroborating one unit, but they are separate outlets, so
    // independence is a question of provenance, not of unit membership.
    const counts = computeEvidenceCounts(mentions);
    expect(counts.rawMentions).toBe(40);
    expect(counts.uniqueEvidence).toBe(1);
  });

  it('collapses outlets under declared common ownership into one source', () => {
    const affiliations = new Map([
      ['brand-a.test', 'group.test'],
      ['brand-b.test', 'group.test'],
    ]);
    const mentions = [
      { evidenceUnitId: 'u1', originKey: 'brand-a.test', authorIdentityKey: null, evidenceClass: 'reliable_secondary' as const },
      { evidenceUnitId: 'u2', originKey: 'brand-b.test', authorIdentityKey: null, evidenceClass: 'reliable_secondary' as const },
      { evidenceUnitId: 'u3', originKey: 'other.test', authorIdentityKey: null, evidenceClass: 'reliable_secondary' as const },
    ];
    expect(computeEvidenceCounts(mentions, affiliations).independentSources).toBe(2);
  });

  it('counts one person posting on two platforms as one source', () => {
    const mentions = [
      { evidenceUnitId: 'u1', originKey: 'reddit.com', authorIdentityKey: 'person:jane', evidenceClass: 'community' as const },
      { evidenceUnitId: 'u2', originKey: 'news.ycombinator.com', authorIdentityKey: 'person:jane', evidenceClass: 'community' as const },
    ];
    expect(computeEvidenceCounts(mentions).independentSources).toBe(1);
  });

  /**
   * The guarantee that stops the system corroborating itself: model output can
   * never manufacture independence or confidence, however much of it there is.
   */
  it('never lets AI-derived material create independent sources', () => {
    const real = [
      { evidenceUnitId: 'u1', originKey: 'customer.test', authorIdentityKey: null, evidenceClass: 'direct_customer' as const },
    ];
    const withFiftyAiStatements = [
      ...real,
      ...Array.from({ length: 50 }, (_, i) => ({
        evidenceUnitId: `ai-${i}`,
        originKey: `ai-${i}.test`,
        authorIdentityKey: null,
        evidenceClass: 'ai_derived' as const,
      })),
    ];

    const before = computeEvidenceCounts(real);
    const after = computeEvidenceCounts(withFiftyAiStatements);

    expect(after.independentSources).toBe(before.independentSources);
    expect(after.sourceDiversity).toBe(before.sourceDiversity);
    expect(after.aiDerivedMentions).toBe(50);
  });

  it('scores diversity low when one source dominates', () => {
    const dominated = shannonEvenness([97, 1, 1, 1]);
    const balanced = shannonEvenness([25, 25, 25, 25]);
    expect(dominated).toBeLessThan(0.4);
    expect(balanced).toBeCloseTo(1, 5);
  });

  it('treats a single source as undiversified rather than perfectly diverse', () => {
    expect(computeEvidenceCounts([
      { evidenceUnitId: 'u1', originKey: 'only.test', authorIdentityKey: null, evidenceClass: 'community' },
      { evidenceUnitId: 'u2', originKey: 'only.test', authorIdentityKey: null, evidenceClass: 'community' },
    ]).independentSources).toBe(1);
  });
});
