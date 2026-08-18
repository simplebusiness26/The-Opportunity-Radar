import { index, jsonb, pgEnum, text, uniqueIndex, uuid, pgTable, integer } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';
import { users, workspaces } from './tenancy';
import { opportunities } from './opportunities';

export const handoffStatusEnum = pgEnum('handoff_status', [
  'prepared',
  'delivering',
  'delivered',
  'failed',
  'acknowledged',
  'completed',
]);

/**
 * The boundary of the product.
 *
 * Radar decides what deserves the next unit of effort; something else builds
 * it. A handoff records what crossed that boundary and when -- the brief is
 * snapshotted rather than referenced, so what the builder was actually given
 * survives every later edit to the opportunity.
 */
export const handoffs = pgTable(
  'handoffs',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    status: handoffStatusEnum('status').notNull().default('prepared'),
    /** The brief exactly as it was when handed over. */
    brief: jsonb('brief').notNull(),
    briefMarkdown: text('brief_markdown').notNull(),
    /** Where it was sent, if anywhere. Null means exported by hand. */
    target: text('target'),
    /** Identifier the receiving system returned, for correlating feedback. */
    externalRef: text('external_ref'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    deliveredAt: ts('delivered_at'),
    acknowledgedAt: ts('acknowledged_at'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('handoffs_workspace_status_idx').on(table.workspaceId, table.status),
    index('handoffs_opportunity_idx').on(table.opportunityId),
    uniqueIndex('handoffs_external_ref_key').on(table.workspaceId, table.externalRef),
  ],
);
