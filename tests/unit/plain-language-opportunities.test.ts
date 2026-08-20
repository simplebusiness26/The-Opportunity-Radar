import { describe, expect, it } from 'vitest';
import { explainOpportunity } from '../../src/application/opportunities/plain-language';
import type { OpportunityRow } from '../../src/ports/repositories/opportunities';

const NOW = new Date('2026-08-20T00:00:00Z');

function opportunity(patch: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: 'opp-1',
    workspaceId: 'workspace-1',
    clusterId: 'cluster-1',
    reference: 23,
    title: 'A recurring bookkeeping problem',
    thesis: 'There may be an opportunity here.',
    typeKey: 'new_product',
    state: 'detected',
    stateSince: NOW,
    targetCustomer: 'small roofing companies',
    problemStatement: 'Repeated independent evidence indicates this problem: owners lose hours every week chasing receipts and reconciling jobs by hand.',
    whyNow: 'Repeated evidence is increasing.',
    notes: {
      autoFraming: {
        uniqueEvidenceCount: 4,
        independentSourceCount: 2,
        clusterConfidence: 0.55,
      },
    },
    ownerUserId: null,
    createdBy: 'manual',
    demo: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe('plain-English opportunity summaries', () => {
  it('keeps a manual opportunity tied to its actual customer and problem', () => {
    const summary = explainOpportunity(opportunity(), null);

    expect(summary.problemEstablished).toBe(true);
    expect(summary.problem).toContain('owners lose hours every week');
    expect(summary.opportunity).toContain('small roofing companies');
    expect(summary.opportunity).toContain('owners lose hours every week');
    expect(summary.nextStep).toContain('Validate the exact buyer');
    expect(summary.whyItAppeared).toContain('4 distinct evidence items');
    expect(summary.whyItAppeared).toContain('2 independent sources');
  });

  it('demotes a legacy Show HN item to signal-only rather than inventing an opportunity', () => {
    const summary = explainOpportunity(
      opportunity({
        createdBy: 'auto',
        title: 'Show HN: Sllm.nvim – Integrate Simon’s LLM cli into Neovim',
        problemStatement:
          'Repeated independent evidence indicates this problem: Show HN: Sllm.nvim – Integrate Simon’s LLM cli into Neovim',
        targetCustomer: null,
      }),
      null,
    );

    expect(summary.problemEstablished).toBe(false);
    expect(summary.headline).toBe('Signal only: Sllm.nvim – Integrate Simon’s LLM cli into Neovim');
    expect(summary.opportunity).toContain('has not passed the commercial opportunity gate');
    expect(summary.opportunity).toContain('should not appear in the normal Opportunity feed');
    expect(summary.nextStep).toContain('Keep it as market intelligence');
  });
});
