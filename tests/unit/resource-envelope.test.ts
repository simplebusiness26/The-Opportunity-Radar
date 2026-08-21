import { describe, expect, it } from 'vitest';
import {
  EARLY_CANDIDATE_ENVELOPE,
  estimateOpportunityResources,
} from '../../src/application/opportunities/resource-envelope';

describe('opportunity resource envelopes', () => {
  it('turns the taxonomy effort prior into focused build hours', () => {
    const envelope = estimateOpportunityResources('new_product');

    expect(envelope.effortDays).toEqual([10, 45]);
    expect(envelope.totalHours).toEqual([60, 270]);
    expect(envelope.budgetLabel).toBe('£500–£5,000');
    expect(envelope.intensityLabel).toBe('Serious build');
  });

  it('keeps early market candidates cheap to validate before a build is committed', () => {
    expect(EARLY_CANDIDATE_ENVELOPE.totalHours).toEqual([6, 24]);
    expect(EARLY_CANDIDATE_ENVELOPE.budgetLabel).toContain('validate');
  });

  it('does not invent delivery effort for strategic waiting', () => {
    const envelope = estimateOpportunityResources('strategic_wait');

    expect(envelope.totalHours).toEqual([0, 0]);
    expect(envelope.budgetLabel).toBe('£0');
  });
});
