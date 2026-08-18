import { index, jsonb, pgEnum, text, uniqueIndex, uuid, pgTable } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { users, workspaces } from './tenancy';
import { opportunities } from './opportunities';

export const relationshipKindEnum = pgEnum('opportunity_relationship_kind', [
  'duplicate_of',
  'supersedes',
  'variant_of',
  'depends_on',
  'competes_with',
  'shares_capability',
  'learned_from',
]);

/**
 * How opportunities relate to each other.
 *
 * Without this the same idea arrives three times under three names, each
 * investigated separately, and a rejected idea's reasoning never reaches the
 * near-identical one proposed six months later.
 */
export const opportunityRelationships = pgTable(
  'opportunity_relationships',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fromOpportunityId: uuid('from_opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    toOpportunityId: uuid('to_opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    kind: relationshipKindEnum('kind').notNull(),
    note: text('note'),
    /** Who or what asserted it, so a proposal is never mistaken for a fact. */
    assertedBy: text('asserted_by').notNull().default('manual'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    evidence: jsonb('evidence').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    // The same pair may hold several relationships, but not the same one twice.
    uniqueIndex('opportunity_relationships_unique').on(
      table.fromOpportunityId,
      table.toOpportunityId,
      table.kind,
    ),
    index('opportunity_relationships_from_idx').on(table.fromOpportunityId),
    index('opportunity_relationships_to_idx').on(table.toOpportunityId),
  ],
);
