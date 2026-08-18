/**
 * How opportunities relate to each other.
 *
 * Without this, the same idea arrives three times under three names and each
 * one is investigated separately. Worse, a rejected idea's reasoning never
 * reaches the near-identical one proposed six months later.
 *
 * The kinds are deliberately few. A rich ontology nobody maintains is worse
 * than a short list people actually use.
 */

export type RelationshipKind =
  | 'duplicate_of'
  | 'supersedes'
  | 'variant_of'
  | 'depends_on'
  | 'competes_with'
  | 'shares_capability'
  | 'learned_from';

export interface RelationshipDefinition {
  key: RelationshipKind;
  label: string;
  meaning: string;
  /** What the relationship reads as from the other end. */
  inverseLabel: string;
  /** Whether both directions are the same relationship. */
  symmetric: boolean;
  /** Whether it implies the subject should not be worked on separately. */
  suppresses: boolean;
}

export const RELATIONSHIP_KINDS: Record<RelationshipKind, RelationshipDefinition> = {
  duplicate_of: {
    key: 'duplicate_of',
    label: 'Duplicate of',
    meaning: 'The same opportunity, recorded twice. Evidence belongs on one of them.',
    inverseLabel: 'Has duplicate',
    symmetric: false,
    suppresses: true,
  },
  supersedes: {
    key: 'supersedes',
    label: 'Supersedes',
    meaning: 'A better-formed version of an earlier idea, which should not be pursued separately.',
    inverseLabel: 'Superseded by',
    symmetric: false,
    suppresses: false,
  },
  variant_of: {
    key: 'variant_of',
    label: 'Variant of',
    meaning: 'A different approach to the same problem. Both may be worth keeping.',
    inverseLabel: 'Variant of',
    symmetric: true,
    suppresses: false,
  },
  depends_on: {
    key: 'depends_on',
    label: 'Depends on',
    meaning: 'Cannot proceed until the other does. Allocation must respect the order.',
    inverseLabel: 'Blocks',
    symmetric: false,
    suppresses: false,
  },
  competes_with: {
    key: 'competes_with',
    label: 'Competes with',
    meaning: 'Both want the same scarce resource, so pursuing one costs the other.',
    inverseLabel: 'Competes with',
    symmetric: true,
    suppresses: false,
  },
  shares_capability: {
    key: 'shares_capability',
    label: 'Shares capability',
    meaning: 'Building either makes the other cheaper. Worth sequencing deliberately.',
    inverseLabel: 'Shares capability',
    symmetric: true,
    suppresses: false,
  },
  learned_from: {
    key: 'learned_from',
    label: 'Learned from',
    meaning: 'An earlier attempt whose outcome should inform this one.',
    inverseLabel: 'Informed',
    symmetric: false,
    suppresses: false,
  },
};

export const RELATIONSHIP_KEYS = Object.keys(RELATIONSHIP_KINDS) as RelationshipKind[];

export function isRelationshipKind(value: string): value is RelationshipKind {
  return value in RELATIONSHIP_KINDS;
}

/**
 * Whether an opportunity should be treated as its own line of work.
 *
 * A duplicate should not appear in the portfolio competing with the thing it
 * duplicates: that would double-count the same idea's claim on the same days.
 */
export function isSuppressedBy(
  relationships: ReadonlyArray<{ kind: RelationshipKind; direction: 'from' | 'to' }>,
): { suppressed: boolean; reason: string | null } {
  for (const relationship of relationships) {
    const definition = RELATIONSHIP_KINDS[relationship.kind];
    if (relationship.direction === 'from' && definition.suppresses) {
      return { suppressed: true, reason: `${definition.label.toLowerCase()} another opportunity` };
    }
    if (relationship.direction === 'to' && relationship.kind === 'supersedes') {
      return { suppressed: true, reason: 'superseded by a later version' };
    }
  }
  return { suppressed: false, reason: null };
}

/**
 * Words that identify what an opportunity is about, for matching it against
 * others and for building re-evaluation triggers.
 *
 * Deliberately crude and deterministic. Its output is always shown to a person
 * as a proposal, never applied silently.
 */
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'would',
  'could', 'should', 'because', 'people', 'thing', 'things', 'that', 'this', 'with', 'from',
  'into', 'they', 'them', 'have', 'more', 'than', 'when', 'what', 'where', 'been', 'being',
  'other', 'every', 'some', 'most', 'much', 'many', 'over', 'under', 'between',
]);

export function keywordsFor(text: string, limit = 6): string[] {
  const counts = new Map<string, number>();

  for (const word of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (word.length < 5 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    // Frequency first, then length: a longer word distinguishes one
    // opportunity from another better than a shorter one, and alphabetical
    // order as the only tie-break would just favour early letters.
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}
