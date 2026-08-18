import { describe, expect, it } from 'vitest';
import {
  assessGrounding,
  retrieve,
  termsOf,
  type RetrievableRecord,
} from '../../src/domain/ask/retrieval';

function record(overrides: Partial<RetrievableRecord> & { id: string }): RetrievableRecord {
  return {
    kind: 'evidence',
    title: 'A record',
    text: 'Some text',
    href: null,
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    isEvidence: true,
    ...overrides,
  };
}

const CORPUS: RetrievableRecord[] = [
  record({
    id: 'evidence:1',
    title: 'Restaurant pays for booking software that cannot take deposits',
    text: 'We pay 180 a month for our booking system and it still cannot take a deposit.',
  }),
  record({
    id: 'opportunity:1',
    kind: 'opportunity',
    title: 'Deposit automation for restaurant bookings',
    text: 'Restaurants already pay for booking software and would pay more for deposits.',
    isEvidence: false,
  }),
  record({
    id: 'evidence:2',
    title: 'Warehouse operator describes stock counting',
    text: 'Counting stock by hand takes two people a full day every month.',
  }),
];

describe('Ask Radar retrieval', () => {
  it('finds the records that bear on the question', () => {
    const ranked = retrieve('what do restaurants pay for booking software', CORPUS);
    const ids = ranked.map((entry) => entry.id);

    expect(ids).toContain('evidence:1');
    expect(ids).toContain('opportunity:1');
    // The warehouse record shares no subject matter and must not be offered as
    // something the answer could rest on.
    expect(ids).not.toContain('evidence:2');
  });

  it('returns nothing for a question the workspace has no records about', () => {
    const ranked = retrieve('what are the shipping tariffs between Chile and Norway', CORPUS);
    expect(ranked).toHaveLength(0);
  });

  it('drops question words that would match everything', () => {
    const terms = termsOf('What should we know about this and where would that be?');
    expect(terms).not.toContain('what');
    expect(terms).not.toContain('about');
    expect(terms).not.toContain('would');
  });

  it('refuses to call a question grounded when nothing was retrieved', () => {
    const verdict = assessGrounding([]);

    expect(verdict.grounded).toBe(false);
    expect(verdict.reason).toContain('no records');
    expect(verdict.remedy).toBeTruthy();
  });

  it('refuses when the closest records do not actually address the question', () => {
    // A weak match is worse than none: it is exactly the situation in which a
    // fluent answer would be least justified and most convincing.
    const ranked = retrieve('deposits', CORPUS, { minimumScore: 0 });
    const weak = ranked.map((entry) => ({ ...entry, score: 0.05 }));

    const verdict = assessGrounding(weak);
    expect(verdict.grounded).toBe(false);
    expect(verdict.reason).toContain('do not actually address');
  });

  it('accepts a single strong match', () => {
    const ranked = retrieve('deposits booking software restaurants pay', CORPUS);
    const verdict = assessGrounding(ranked);

    expect(verdict.grounded).toBe(true);
    expect(verdict.reason).toContain('bear on this');
  });
});
