import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { handoffs } from '../schema/index';
import type { HandoffRepository, HandoffRow } from '../../../ports/repositories/execution';

export function createHandoffRepository(db: Executor): HandoffRepository {
  return {
    async create(workspaceId, input) {
      const [row] = await db
        .insert(handoffs)
        .values({
          workspaceId,
          opportunityId: input.opportunityId,
          brief: input.brief,
          briefMarkdown: input.briefMarkdown,
          target: input.target,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      if (!row) throw new Error('create handoff returned no row');
      return toRow(row);
    },

    async findById(workspaceId, id) {
      const [row] = await db
        .select()
        .from(handoffs)
        .where(and(eq(handoffs.workspaceId, workspaceId), eq(handoffs.id, id)))
        .limit(1);
      return row ? toRow(row) : null;
    },

    async findByExternalRef(workspaceId, externalRef) {
      const [row] = await db
        .select()
        .from(handoffs)
        .where(and(eq(handoffs.workspaceId, workspaceId), eq(handoffs.externalRef, externalRef)))
        .limit(1);
      return row ? toRow(row) : null;
    },

    async findAcrossWorkspaces(input) {
      if (input.id) {
        const [row] = await db.select().from(handoffs).where(eq(handoffs.id, input.id)).limit(1);
        return row ? toRow(row) : null;
      }
      if (input.externalRef) {
        const [row] = await db
          .select()
          .from(handoffs)
          .where(eq(handoffs.externalRef, input.externalRef))
          .limit(1);
        return row ? toRow(row) : null;
      }
      return null;
    },

    async list(workspaceId, options = {}) {
      const conditions = [eq(handoffs.workspaceId, workspaceId)];
      if (options.opportunityId) conditions.push(eq(handoffs.opportunityId, options.opportunityId));

      const rows = await db
        .select()
        .from(handoffs)
        .where(and(...conditions))
        .orderBy(desc(handoffs.createdAt))
        .limit(options.limit ?? 50);
      return rows.map(toRow);
    },

    async markDelivering(handoffId, now) {
      await db
        .update(handoffs)
        .set({ status: 'delivering', attempts: sql`${handoffs.attempts} + 1`, updatedAt: now })
        .where(eq(handoffs.id, handoffId));
    },

    async markDelivered(handoffId, input, now) {
      await db
        .update(handoffs)
        .set({
          status: 'delivered',
          externalRef: input.externalRef,
          deliveredAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(handoffs.id, handoffId));
    },

    async markFailed(handoffId, error, now) {
      await db
        .update(handoffs)
        .set({ status: 'failed', lastError: error, updatedAt: now })
        .where(eq(handoffs.id, handoffId));
    },

    async markAcknowledged(handoffId, now) {
      await db
        .update(handoffs)
        .set({ status: 'acknowledged', acknowledgedAt: now, updatedAt: now })
        .where(eq(handoffs.id, handoffId));
    },

    async markCompleted(handoffId, now) {
      await db
        .update(handoffs)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(handoffs.id, handoffId));
    },
  };
}

function toRow(row: typeof handoffs.$inferSelect): HandoffRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    status: row.status,
    brief: (row.brief ?? {}) as Record<string, unknown>,
    briefMarkdown: row.briefMarkdown,
    target: row.target,
    externalRef: row.externalRef,
    attempts: row.attempts,
    lastError: row.lastError,
    deliveredAt: row.deliveredAt,
    acknowledgedAt: row.acknowledgedAt,
    createdAt: row.createdAt,
  };
}
