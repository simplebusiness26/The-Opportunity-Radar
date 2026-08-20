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
    createdBy: 'system',
    demo: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe('plain-English opportunity summaries', () => {
  it('turns a clear problem into a quick commercial explanation', () => {
    const summary = explainOpportunity(opportunity(), null);

    expect(summary.problemEstablished).toBe(true);
    expect(summary.problem).toContain('owners lose hours every week');
    expect(summary.opportunity).toContain('small roofing companies');
    expect(summary.nextStep).toContain('Do not build the full solution yet');
    expect(summary.whyItAppeared).toContain('4 distinct evidence items');
    expect(summary.whyItAppeared).toContain('2 independent sources');
  });

  it('does not pretend a Show HN headline is already a customer problem', () => {
    const summary = explainOpportunity(
      opportunity({
        title: 'Show HN: Sllm.nvim – Integrate Simon’s LLM cli into Neovim',
        problemStatement:
          'Repeated independent evidence indicates this problem: Show HN: Sllm.nvim – Integrate Simon’s LLM cli into Neovim',
        targetCustomer: null,
      }),
      null,
    );

    expect(summary.problemEstablished).toBe(false);
    expect(summary.headline).toBe('Investigate demand around: Sllm.nvim – Integrate Simon’s LLM cli into Neovim');
    expect(summary.problem).toContain('has not yet established the specific customer problem');
    expect(summary.opportunity).toContain('find out whether this activity points to a real unmet need');
    expect(summary.nextStep).toContain('If those are not found, drop it rather than build it');
  });
});
