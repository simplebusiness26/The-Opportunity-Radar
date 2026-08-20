import { describe, expect, it } from 'vitest';
import { detectSignalType } from '../../src/adapters/sources/shared';
import {
  describeCommercialOpening,
  isEligibleForAutomaticProblemClustering,
  qualifyCommercialOpportunity,
} from '../../src/domain/opportunities/automatic-framing-safety';

describe('commercial opportunity qualification', () => {
  it('classifies unrecognised and launch activity as trend rather than pain', () => {
    expect(detectSignalType('Show HN: Slim.nvim – integrate an LLM CLI into Neovim')).toBe('trend');
    expect(detectSignalType('A new open source project for terminal tabs')).toBe('trend');
  });

  it('keeps Show HN product activity out of problem clustering even for legacy pain rows', () => {
    expect(
      isEligibleForAutomaticProblemClustering(
        'Show HN: Slim.nvim – integrate an LLM CLI into Neovim (500 LOC Lua)',
        'pain',
      ),
    ).toBe(false);
  });

  it('does not promote repeated pain without a commercial mechanism', () => {
    const result = qualifyCommercialOpportunity([
      {
        signalTypeKey: 'pain',
        claimText: 'Restaurant owners lose bookings when deposits are tracked manually',
        bodyText: 'The manual process takes hours and bookings get missed.',
        originKeys: ['restaurant-a'],
      },
      {
        signalTypeKey: 'pain',
        claimText: 'Another restaurant struggles with manual deposit tracking',
        bodyText: 'Staff waste time and sometimes miss a booking.',
        originKeys: ['restaurant-b'],
      },
    ]);

    expect(result.eligible).toBe(false);
    expect(result.problemProofCount).toBe(2);
    expect(result.commercialProofCount).toBe(0);
  });

  it('promotes a corroborated problem when behaviour shows a concrete commercial opening', () => {
    const result = qualifyCommercialOpportunity([
      {
        signalTypeKey: 'workaround',
        claimText: 'Small businesses copy enquiries from WhatsApp and email into a spreadsheet',
        bodyText: 'Teams manually copy and paste leads into one sheet so follow-ups are not lost.',
        originKeys: ['business-a'],
      },
      {
        signalTypeKey: 'demand',
        claimText: 'Small teams are looking for one place to handle incoming enquiries',
        bodyText: 'Looking for software that puts WhatsApp, email and website enquiries together.',
        originKeys: ['business-b'],
      },
    ]);

    expect(result.eligible).toBe(true);
    expect(result.commercialProofCount).toBe(2);
    expect(result.independentOrigins).toBe(2);
    expect(result.strongestSignalType).toBe('workaround');
    expect(
      describeCommercialOpening(
        'Repeated independent evidence indicates this problem: Small businesses lose leads because enquiries are scattered across WhatsApp, email and web forms.',
        result.strongestSignalType,
      ),
    ).toContain('Replace the existing manual or stitched-together workaround');
  });
});
