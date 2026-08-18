import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';

/**
 * The scenario-corpus evaluation suite -- ten corpora scored across six
 * behaviours -- is built in the hardening phase, once every behaviour it scores
 * exists to be scored.
 *
 * Until then this stage is not pretending to evaluate anything. The behaviours
 * it will cover are currently asserted directly: prompt safety and structured
 * output in the unit suite, extraction and citation discipline in the
 * investigation and Ask Radar integration suites.
 *
 * What this file does assert is that the fixtures those evaluations will read
 * are present, so the stage fails loudly rather than silently scoring nothing.
 */
describe('evaluation suite', () => {
  it('has the fixture corpora the evaluations will read', () => {
    const injection = readdirSync('fixtures/injection');
    const ssrf = readdirSync('fixtures/ssrf');

    expect(injection).toContain('payloads.json');
    expect(ssrf).toContain('hostile-urls.json');
  });

  it('is not yet scoring model behaviour, and does not claim to', () => {
    // Deliberately explicit. A green stage that evaluates nothing is worse
    // than a missing one, because it reads as coverage.
    expect(true).toBe(true);
  });
});
