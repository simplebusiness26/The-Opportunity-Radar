import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { opportunities, opportunityRelationships, reevaluationTriggers } from '../schema/index';
import type {
  RelationshipRepository,
  RelationshipRow,
  TriggerRepository,
  TriggerRow,
} from '../../../ports/repositories/memory';
import type { RelationshipKind } from '../../../domain/memory/relationships';
import type { TriggerPredicate } from '../../../domain/memory/triggers';

export function createTriggerRepository(db: Executor): TriggerRepository {
  return {
    async create(workspaceId, input, now) {
      const [row] = await db
        .insert(reevaluationTriggers)
        .values({
          workspaceId,
          opportunityId: input.opportunityId,
          kind: input.kind,
          description: input.description,
          predicate: input.predicate,
          // From the injected clock rather than the database default: a
          // trigger's arming time is compared against evidence timestamps that
          // come from the clock, and two sources of "now" would make the
          // comparison meaningless.
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error('create trigger returned no row');
      return toTriggerRow(row);
    },

    async listFor(workspaceId, opportunityId) {
      const rows = await db
        .select()
        .from(reevaluationTriggers)
        .where(
          and(
            eq(reevaluationTriggers.workspaceId, workspaceId),
            eq(reevaluationTriggers.opportunityId, opportunityId),
          ),
        )
        .orderBy(desc(reevaluationTriggers.createdAt));
      return rows.map(toTriggerRow);
    },

    async listActive(workspaceId, limit = 200) {
      const rows = await db
        .select()
        .from(reevaluationTriggers)
        .where(
          and(
            eq(reevaluationTriggers.workspaceId, workspaceId),
            eq(reevaluationTriggers.active, true),
            isNull(reevaluationTriggers.firedAt),
          ),
        )
        .limit(limit);
      return rows.map(toTriggerRow);
    },

    async markChecked(triggerIds, at) {
      if (triggerIds.length === 0) return;
      await db
        .update(reevaluationTriggers)
        .set({
          lastCheckedAt: at,
          // Counted so a trigger nobody has satisfied in a year is visible as
          // such, rather than looking like it was never tried.
          checkCount: sql`${reevaluationTriggers.checkCount} + 1`,
        })
        .where(inArray(reevaluationTriggers.id, triggerIds));
    },

    async fire(triggerId, input) {
      await db
        .update(reevaluationTriggers)
        .set({ firedAt: input.at, firedSignalId: input.signalId, active: false })
        .where(eq(reevaluationTriggers.id, triggerId));
    },

    async deactivate(workspaceId, triggerId) {
      await db
        .update(reevaluationTriggers)
        .set({ active: false })
        .where(
          and(
            eq(reevaluationTriggers.workspaceId, workspaceId),
            eq(reevaluationTriggers.id, triggerId),
          ),
        );
    },
  };
}

export function createRelationshipRepository(db: Executor): RelationshipRepository {
  return {
    async link(workspaceId, input) {
      const [row] = await db
        .insert(opportunityRelationships)
        .values({
          workspaceId,
          fromOpportunityId: input.fromOpportunityId,
          toOpportunityId: input.toOpportunityId,
          kind: input.kind,
          note: input.note ?? null,
          assertedBy: input.assertedBy,
          createdByUserId: input.createdByUserId ?? null,
          evidence: input.evidence ?? {},
        })
        // Re-asserting the same link is not an error; it updates the note.
        .onConflictDoUpdate({
          target: [
            opportunityRelationships.fromOpportunityId,
            opportunityRelationships.toOpportunityId,
            opportunityRelationships.kind,
          ],
          set: { note: input.note ?? null, assertedBy: input.assertedBy },
        })
        .returning();
      if (!row) throw new Error('link relationship returned no row');
      return toRelationshipRow(row);
    },

    async unlink(workspaceId, relationshipId) {
      await db
        .delete(opportunityRelationships)
        .where(
          and(
            eq(opportunityRelationships.workspaceId, workspaceId),
            eq(opportunityRelationships.id, relationshipId),
          ),
        );
    },

    async listFor(workspaceId, opportunityId) {
      const outgoing = await db
        .select({
          relationship: opportunityRelationships,
          otherTitle: opportunities.title,
          otherReference: opportunities.reference,
          otherState: opportunities.state,
        })
        .from(opportunityRelationships)
        .innerJoin(opportunities, eq(opportunities.id, opportunityRelationships.toOpportunityId))
        .where(
          and(
            eq(opportunityRelationships.workspaceId, workspaceId),
            eq(opportunityRelationships.fromOpportunityId, opportunityId),
          ),
        );

      const incoming = await db
        .select({
          relationship: opportunityRelationships,
          otherTitle: opportunities.title,
          otherReference: opportunities.reference,
          otherState: opportunities.state,
        })
        .from(opportunityRelationships)
        .innerJoin(opportunities, eq(opportunities.id, opportunityRelationships.fromOpportunityId))
        .where(
          and(
            eq(opportunityRelationships.workspaceId, workspaceId),
            eq(opportunityRelationships.toOpportunityId, opportunityId),
          ),
        );

      return [
        ...outgoing.map((entry) => ({
          ...toRelationshipRow(entry.relationship),
          direction: 'from' as const,
          otherTitle: entry.otherTitle,
          otherReference: entry.otherReference,
          otherState: entry.otherState as string,
        })),
        ...incoming.map((entry) => ({
          ...toRelationshipRow(entry.relationship),
          direction: 'to' as const,
          otherTitle: entry.otherTitle,
          otherReference: entry.otherReference,
          otherState: entry.otherState as string,
        })),
      ];
    },

    async listAll(workspaceId, limit = 500) {
      const rows = await db
        .select()
        .from(opportunityRelationships)
        .where(eq(opportunityRelationships.workspaceId, workspaceId))
        .limit(limit);
      return rows.map(toRelationshipRow);
    },
  };
}

function toTriggerRow(row: typeof reevaluationTriggers.$inferSelect): TriggerRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    opportunityId: row.opportunityId,
    kind: row.kind,
    description: row.description,
    predicate: (row.predicate ?? {}) as TriggerPredicate,
    active: row.active,
    lastCheckedAt: row.lastCheckedAt,
    firedAt: row.firedAt,
    firedSignalId: row.firedSignalId,
    checkCount: row.checkCount,
    createdAt: row.createdAt,
  };
}

function toRelationshipRow(row: typeof opportunityRelationships.$inferSelect): RelationshipRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    fromOpportunityId: row.fromOpportunityId,
    toOpportunityId: row.toOpportunityId,
    kind: row.kind as RelationshipKind,
    note: row.note,
    assertedBy: row.assertedBy,
    createdAt: row.createdAt,
  };
}
