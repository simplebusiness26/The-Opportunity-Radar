import { OPPORTUNITY_TYPES, type OpportunityTypeKey } from '../../domain/taxonomy/opportunity-types';

export interface OpportunityResourceEnvelope {
  effortDays: [number, number];
  totalHours: [number, number];
  budgetLabel: string;
  intensityLabel: string;
  basis: string;
}

const BUDGET_PRIORS: Record<OpportunityTypeKey, string> = {
  new_product: '£500–£5,000',
  new_company: '£2,500–£25,000+',
  existing_product_feature: '£0–£1,500',
  existing_product_pivot: '£1,000–£7,500',
  productisation: '£0–£1,500',
  internal_automation: '£0–£1,000',
  distribution: '£0–£1,500',
  content: '£0–£500',
  partnership: '£0–£1,500',
  api: '£500–£5,000',
  data: '£500–£5,000',
  licensing: '£0–£1,500',
  service: '£0–£500',
  acquisition: '£10,000+',
  capability_investment: '£0–£2,500',
  cost_reduction: '£0–£1,000',
  market_expansion: '£500–£5,000',
  combination: '£500–£5,000',
  strategic_wait: '£0',
  kill: '£0',
};

function intensityFromHours(maxHours: number): string {
  if (maxHours <= 24) return 'Light';
  if (maxHours <= 90) return 'Part-time';
  if (maxHours <= 270) return 'Serious build';
  return 'Major commitment';
}

/**
 * A planning prior, not a quote. Radar uses the taxonomy's existing effort-day
 * ranges and converts them to focused build hours at six productive hours/day.
 * Cash bands are deliberately broad until requirements are scoped.
 */
export function estimateOpportunityResources(typeKey: OpportunityTypeKey): OpportunityResourceEnvelope {
  const type = OPPORTUNITY_TYPES[typeKey];
  const effortDays = type.typicalEffortDays;
  const totalHours: [number, number] = [effortDays[0] * 6, effortDays[1] * 6];

  return {
    effortDays,
    totalHours,
    budgetLabel: BUDGET_PRIORS[typeKey],
    intensityLabel: intensityFromHours(totalHours[1]),
    basis: 'Planning estimate from Radar’s typical effort prior; scope before spending.',
  };
}

export const EARLY_CANDIDATE_ENVELOPE: OpportunityResourceEnvelope = {
  effortDays: [1, 4],
  totalHours: [6, 24],
  budgetLabel: '£0–£500 to validate',
  intensityLabel: 'Light validation',
  basis: 'Validation envelope only. Full delivery cost is estimated after the buyer and commercial mechanism are proved.',
};
