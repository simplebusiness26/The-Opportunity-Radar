/**
 * The signal taxonomy.
 *
 * A signal is one meaningful piece of potential evidence, and its type governs
 * how much it can ever be worth: a complaint and a receipt are not the same
 * claim about the world. Half-lives live here too, because how fast evidence
 * goes stale is a property of what kind of evidence it is.
 */

export type SignalTypeKey =
  | 'pain'
  | 'demand'
  | 'spending'
  | 'workaround'
  | 'labour'
  | 'technology_unlock'
  | 'cost_collapse'
  | 'competitor_weakness'
  | 'supply_gap'
  | 'trend'
  | 'regulation'
  | 'distribution'
  | 'behaviour_shift'
  | 'infrastructure'
  | 'capability'
  | 'asset';

export type DecayMode = 'time' | 'event';

export interface SignalTypeDefinition {
  key: SignalTypeKey;
  label: string;
  description: string;
  /** What a good example of this signal actually looks like. */
  example: string;
  /**
   * How strongly this type of observation, on its own, indicates a real
   * opportunity. Complaints are cheap; money changing hands is not.
   */
  baseStrength: number;
  halfLifeDays: number;
  decayMode: DecayMode;
  /** Events that invalidate the signal when decay is event-driven. */
  supersededBy?: string[];
}

export const SIGNAL_TYPES: Record<SignalTypeKey, SignalTypeDefinition> = {
  pain: {
    key: 'pain',
    label: 'Pain',
    description: 'Someone has a meaningful problem.',
    example: '"Reconciling our bookings against deposits takes me every Monday morning."',
    baseStrength: 0.45,
    halfLifeDays: 540,
    decayMode: 'time',
  },
  demand: {
    key: 'demand',
    label: 'Demand',
    description: 'Someone is actively asking for a solution.',
    example: '"Is there anything that automatically chases no-shows?"',
    baseStrength: 0.6,
    halfLifeDays: 365,
    decayMode: 'time',
  },
  spending: {
    key: 'spending',
    label: 'Spending',
    description: 'Money is already being spent on the problem.',
    example: '"We pay £400 a month for this and it still barely works."',
    baseStrength: 0.9,
    halfLifeDays: 365,
    decayMode: 'time',
  },
  workaround: {
    key: 'workaround',
    label: 'Workaround',
    description: 'People manually combine tools or processes to cope.',
    example: 'A spreadsheet, two integrations and a weekly manual export.',
    baseStrength: 0.7,
    halfLifeDays: 400,
    decayMode: 'time',
  },
  labour: {
    key: 'labour',
    label: 'Labour',
    description: 'Humans are repeatedly paid to perform the function.',
    example: 'Recurring job adverts for a reservations administrator.',
    baseStrength: 0.8,
    halfLifeDays: 120,
    decayMode: 'time',
  },
  technology_unlock: {
    key: 'technology_unlock',
    label: 'Technology unlock',
    description: 'New technology makes an old problem newly solvable.',
    example: 'A model or API that removes a previously prohibitive step.',
    baseStrength: 0.65,
    halfLifeDays: 180,
    decayMode: 'time',
  },
  cost_collapse: {
    key: 'cost_collapse',
    label: 'Cost collapse',
    description: 'The cost of providing a solution has dropped materially.',
    example: 'Inference or storage pricing falling by most of its value.',
    baseStrength: 0.7,
    // Pricing moves fast, so a year-old price is close to worthless.
    halfLifeDays: 45,
    decayMode: 'time',
  },
  competitor_weakness: {
    key: 'competitor_weakness',
    label: 'Competitor weakness',
    description: 'Users consistently dislike part of an existing solution.',
    example: 'Reviews repeatedly naming the same broken workflow.',
    baseStrength: 0.6,
    halfLifeDays: 270,
    decayMode: 'time',
  },
  supply_gap: {
    key: 'supply_gap',
    label: 'Supply gap',
    description: 'Available supply appears inadequate to demand.',
    example: 'Waiting lists, or every provider quoting months out.',
    baseStrength: 0.6,
    halfLifeDays: 180,
    decayMode: 'time',
  },
  trend: {
    key: 'trend',
    label: 'Trend',
    description: 'Interest or adoption appears to be increasing.',
    example: 'Sustained growth in searches or community activity.',
    // Deliberately weak on its own: interest is not an opportunity.
    baseStrength: 0.25,
    halfLifeDays: 60,
    decayMode: 'time',
  },
  regulation: {
    key: 'regulation',
    label: 'Regulation',
    description: 'Policy or legal change creates demand or constraint.',
    example: 'A compliance deadline that forces a purchase.',
    baseStrength: 0.75,
    // Regulation does not fade with time; it is replaced or repealed.
    halfLifeDays: 3650,
    decayMode: 'event',
    supersededBy: ['regulation.superseded', 'regulation.repealed'],
  },
  distribution: {
    key: 'distribution',
    label: 'Distribution',
    description: 'A new way of reaching these users becomes available.',
    example: 'A marketplace or platform opening to third parties.',
    baseStrength: 0.55,
    halfLifeDays: 150,
    decayMode: 'time',
  },
  behaviour_shift: {
    key: 'behaviour_shift',
    label: 'Behaviour shift',
    description: 'User behaviour is materially changing.',
    example: 'A task moving from desktop to phone, or from staff to self-serve.',
    baseStrength: 0.5,
    halfLifeDays: 365,
    decayMode: 'time',
  },
  infrastructure: {
    key: 'infrastructure',
    label: 'Infrastructure',
    description: 'A new platform, API or ecosystem enables opportunities.',
    example: 'A payments or identity rail becoming generally available.',
    baseStrength: 0.5,
    halfLifeDays: 240,
    decayMode: 'time',
  },
  capability: {
    key: 'capability',
    label: 'Our capability',
    description: 'An internal capability gives us leverage here.',
    example: 'We already run multi-tenant billing in production.',
    baseStrength: 0.6,
    halfLifeDays: 3650,
    // Internal capability holds until the code behind it actually changes.
    decayMode: 'event',
    supersededBy: ['repo.changed', 'capability.retired'],
  },
  asset: {
    key: 'asset',
    label: 'Our asset',
    description: 'Existing internal technology, data or distribution is reusable.',
    example: 'An audience, a dataset, or a component built for something else.',
    baseStrength: 0.6,
    halfLifeDays: 3650,
    decayMode: 'event',
    supersededBy: ['repo.changed', 'asset.retired'],
  },
};

export const SIGNAL_TYPE_KEYS = Object.keys(SIGNAL_TYPES) as SignalTypeKey[];

export function isSignalTypeKey(value: string): value is SignalTypeKey {
  return value in SIGNAL_TYPES;
}

/**
 * Types that describe money or committed effort. Any thesis that rests only on
 * complaints and interest, with none of these, has not shown that anyone would
 * pay -- which is exactly the failure mode the product exists to catch.
 */
export const MONETARY_SIGNAL_TYPES: readonly SignalTypeKey[] = [
  'spending',
  'labour',
  'supply_gap',
];
