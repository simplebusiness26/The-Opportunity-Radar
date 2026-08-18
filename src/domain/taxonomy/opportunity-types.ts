/**
 * An opportunity is not necessarily a new company.
 *
 * Treating "start something new" as the only possible answer is the central
 * mistake of every opportunity finder. Often the highest-return move is to
 * improve something that already exists, sell what has already been built, or
 * do nothing at all -- and the system has to be able to say so.
 */

export type OpportunityTypeKey =
  | 'new_product'
  | 'new_company'
  | 'existing_product_feature'
  | 'existing_product_pivot'
  | 'productisation'
  | 'internal_automation'
  | 'distribution'
  | 'content'
  | 'partnership'
  | 'api'
  | 'data'
  | 'licensing'
  | 'service'
  | 'acquisition'
  | 'capability_investment'
  | 'cost_reduction'
  | 'market_expansion'
  | 'combination'
  | 'strategic_wait'
  | 'kill';

export type OpportunityCategory =
  | 'create'
  | 'extend'
  | 'leverage'
  | 'reach'
  | 'acquire'
  | 'restraint';

export interface OpportunityTypeDefinition {
  key: OpportunityTypeKey;
  label: string;
  category: OpportunityCategory;
  description: string;
  /** Typical effort, used only as a prior until real history exists. */
  typicalEffortDays: [number, number];
  /** Whether pursuing this normally needs new customers found from scratch. */
  requiresNewAudience: boolean;
}

export const OPPORTUNITY_TYPES: Record<OpportunityTypeKey, OpportunityTypeDefinition> = {
  new_product: {
    key: 'new_product',
    label: 'New product',
    category: 'create',
    description: 'Build something new for a problem we can already reach.',
    typicalEffortDays: [10, 45],
    requiresNewAudience: false,
  },
  new_company: {
    key: 'new_company',
    label: 'New company',
    category: 'create',
    description: 'A separate venture with its own market, brand and economics.',
    typicalEffortDays: [30, 180],
    requiresNewAudience: true,
  },
  existing_product_feature: {
    key: 'existing_product_feature',
    label: 'Feature in an existing product',
    category: 'extend',
    description: 'Serve the demand from inside something we already run.',
    typicalEffortDays: [2, 15],
    requiresNewAudience: false,
  },
  existing_product_pivot: {
    key: 'existing_product_pivot',
    label: 'Pivot an existing product',
    category: 'extend',
    description: 'Point an existing product at a better-evidenced problem.',
    typicalEffortDays: [5, 40],
    requiresNewAudience: true,
  },
  productisation: {
    key: 'productisation',
    label: 'Productise what we already built',
    category: 'leverage',
    description: 'Turn an internal component or process into something sellable.',
    typicalEffortDays: [3, 20],
    requiresNewAudience: false,
  },
  internal_automation: {
    key: 'internal_automation',
    label: 'Internal automation',
    category: 'leverage',
    description: 'Remove our own recurring cost rather than chase revenue.',
    typicalEffortDays: [1, 10],
    requiresNewAudience: false,
  },
  distribution: {
    key: 'distribution',
    label: 'Distribution',
    category: 'reach',
    description: 'Open a new channel to people we can already serve.',
    typicalEffortDays: [2, 20],
    requiresNewAudience: false,
  },
  content: {
    key: 'content',
    label: 'Content',
    category: 'reach',
    description: 'Build attention and standing around an emerging topic.',
    typicalEffortDays: [1, 15],
    requiresNewAudience: true,
  },
  partnership: {
    key: 'partnership',
    label: 'Partnership',
    category: 'reach',
    description: 'Reach a market through someone who already has it.',
    typicalEffortDays: [3, 30],
    requiresNewAudience: false,
  },
  api: {
    key: 'api',
    label: 'API',
    category: 'leverage',
    description: 'Expose an existing capability for others to build on.',
    typicalEffortDays: [3, 20],
    requiresNewAudience: true,
  },
  data: {
    key: 'data',
    label: 'Data',
    category: 'leverage',
    description: 'Create value from data we hold or can legitimately gather.',
    typicalEffortDays: [3, 25],
    requiresNewAudience: true,
  },
  licensing: {
    key: 'licensing',
    label: 'Licensing',
    category: 'leverage',
    description: 'Let others use what we have built, on our terms.',
    typicalEffortDays: [2, 15],
    requiresNewAudience: true,
  },
  service: {
    key: 'service',
    label: 'Service',
    category: 'create',
    description: 'Sell the outcome directly before automating it.',
    typicalEffortDays: [1, 10],
    requiresNewAudience: false,
  },
  acquisition: {
    key: 'acquisition',
    label: 'Acquisition',
    category: 'acquire',
    description: 'Buy a capability, customer base or product rather than build it.',
    typicalEffortDays: [10, 90],
    requiresNewAudience: false,
  },
  capability_investment: {
    key: 'capability_investment',
    label: 'Capability investment',
    category: 'acquire',
    description: 'Build a capability that makes several future moves cheaper.',
    typicalEffortDays: [3, 30],
    requiresNewAudience: false,
  },
  cost_reduction: {
    key: 'cost_reduction',
    label: 'Cost reduction',
    category: 'leverage',
    description: 'Improve margin on what we already run.',
    typicalEffortDays: [1, 12],
    requiresNewAudience: false,
  },
  market_expansion: {
    key: 'market_expansion',
    label: 'Market expansion',
    category: 'extend',
    description: 'Take a working product to an adjacent segment or geography.',
    typicalEffortDays: [3, 30],
    requiresNewAudience: true,
  },
  combination: {
    key: 'combination',
    label: 'Combination',
    category: 'leverage',
    description: 'Join two things we already own into something worth more.',
    typicalEffortDays: [3, 25],
    requiresNewAudience: false,
  },
  strategic_wait: {
    key: 'strategic_wait',
    label: 'Wait',
    category: 'restraint',
    description:
      'The thesis may be right but acting now is premature. Watch for the specific change that would make it ready.',
    typicalEffortDays: [0, 0],
    requiresNewAudience: false,
  },
  kill: {
    key: 'kill',
    label: 'Kill or divest',
    category: 'restraint',
    description:
      'Stop spending on this. Recording what was avoided is as valuable as recording what was built.',
    typicalEffortDays: [0, 1],
    requiresNewAudience: false,
  },
};

export const OPPORTUNITY_TYPE_KEYS = Object.keys(OPPORTUNITY_TYPES) as OpportunityTypeKey[];

export function isOpportunityTypeKey(value: string): value is OpportunityTypeKey {
  return value in OPPORTUNITY_TYPES;
}

/** Types that consume little or no delivery capacity. */
export const RESTRAINT_TYPES: readonly OpportunityTypeKey[] = ['strategic_wait', 'kill'];
