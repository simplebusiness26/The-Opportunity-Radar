/**
 * How much a piece of evidence is worth depends on where it came from, not on
 * how often it was repeated. These tiers are what stop a widely-syndicated
 * opinion piece from outweighing one customer saying what they actually pay.
 */

export type EvidenceClass =
  | 'direct_customer'
  | 'transaction'
  | 'primary'
  | 'reliable_secondary'
  | 'community'
  | 'social'
  | 'ai_derived';

export interface EvidenceClassDefinition {
  key: EvidenceClass;
  label: string;
  description: string;
  /** Multiplier applied to a signal's base strength. */
  weight: number;
  /**
   * Whether this class may ever count toward independent source counts and
   * confidence. AI output never can: it is a restatement of other evidence, and
   * counting it would let the system confirm itself.
   */
  countsAsIndependent: boolean;
  halfLifeDays: number;
}

export const EVIDENCE_CLASSES: Record<EvidenceClass, EvidenceClassDefinition> = {
  direct_customer: {
    key: 'direct_customer',
    label: 'Direct customer evidence',
    description: 'A named customer describing their own problem, spend or behaviour.',
    weight: 1,
    countsAsIndependent: true,
    halfLifeDays: 540,
  },
  transaction: {
    key: 'transaction',
    label: 'Transaction or behaviour evidence',
    description: 'Observed purchasing or usage, rather than a report of it.',
    weight: 1,
    countsAsIndependent: true,
    halfLifeDays: 365,
  },
  primary: {
    key: 'primary',
    label: 'Primary source',
    description: 'An official company, regulator, public dataset or API.',
    weight: 0.85,
    countsAsIndependent: true,
    halfLifeDays: 540,
  },
  reliable_secondary: {
    key: 'reliable_secondary',
    label: 'Reliable secondary source',
    description: 'Credible research or reporting that cites its own evidence.',
    weight: 0.65,
    countsAsIndependent: true,
    halfLifeDays: 270,
  },
  community: {
    key: 'community',
    label: 'Community discussion',
    description: 'Forum and community conversation: often genuine, always noisy.',
    weight: 0.5,
    countsAsIndependent: true,
    halfLifeDays: 365,
  },
  social: {
    key: 'social',
    label: 'Social signal',
    description: 'Social posts and engagement. Supporting evidence, never load-bearing.',
    weight: 0.25,
    countsAsIndependent: true,
    halfLifeDays: 90,
  },
  ai_derived: {
    key: 'ai_derived',
    label: 'AI-derived statement',
    description:
      'Produced by a model rather than observed. Useful for summarising, and never counted as evidence in its own right.',
    weight: 0,
    countsAsIndependent: false,
    halfLifeDays: 90,
  },
};

export const EVIDENCE_CLASS_KEYS = Object.keys(EVIDENCE_CLASSES) as EvidenceClass[];

export function isEvidenceClass(value: string): value is EvidenceClass {
  return value in EVIDENCE_CLASSES;
}

export function countsAsIndependent(evidenceClass: EvidenceClass): boolean {
  return EVIDENCE_CLASSES[evidenceClass].countsAsIndependent;
}

export function evidenceWeight(evidenceClass: EvidenceClass): number {
  return EVIDENCE_CLASSES[evidenceClass].weight;
}

/** Ranked strongest first, for tie-breaking and for choosing a representative. */
export const EVIDENCE_CLASS_RANK: readonly EvidenceClass[] = [
  'transaction',
  'direct_customer',
  'primary',
  'reliable_secondary',
  'community',
  'social',
  'ai_derived',
];

export function isStrongerEvidence(a: EvidenceClass, b: EvidenceClass): boolean {
  return EVIDENCE_CLASS_RANK.indexOf(a) < EVIDENCE_CLASS_RANK.indexOf(b);
}
