import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { auditLog } from '../schema/index';
import type { ActorCtx } from '../../../domain/types/identity';
import type { AuditEntry } from '../../../ports/repositories/audit';
import { actorKind, actorUserId } from '../../../domain/types/identity';
import type { AuditRepository, AuditRow } from '../../../ports/repositories/audit';

/**
 * Written inside the same transaction as the change it describes, so the log
 * cannot disagree with the data. There is no update or delete path.
 */
export async function recordAudit(db: Executor, ctx: ActorCtx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    workspaceId: ctx.workspaceId,
    actorKind: actorKind(ctx),
    actorUserId: actorUserId(ctx),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: ctx.requestId ?? null,
    ipHash: 'ipHash' in ctx ? (ctx.ipHash ?? null) : null,
  });
}

/** Audit rows written before a workspace exists (sign-up, failed sign-in). */
export async function recordSystemAudit(
  db: Executor,
  entry: AuditEntry & { requestId?: string; ipHash?: string; userId?: string },
): Promise<void> {
  await db.insert(auditLog).values({
    workspaceId: null,
    actorKind: entry.userId ? 'user' : 'system',
    actorUserId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: entry.requestId ?? null,
    ipHash: entry.ipHash ?? null,
  });
}

export async function listAudit(
  db: Executor,
  workspaceId: string,
  options: { limit?: number; action?: string; entityType?: string; entityId?: string } = {},
) {
  const conditions = [eq(auditLog.workspaceId, workspaceId)];
  if (options.action) conditions.push(eq(auditLog.action, options.action));
  if (options.entityType) conditions.push(eq(auditLog.entityType, options.entityType));
  if (options.entityId) conditions.push(eq(auditLog.entityId, options.entityId));

  return db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(options.limit ?? 100, 500));
}

export async function countAuditActions(
  db: Executor,
  workspaceId: string,
  action: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.action, action)));
  return rows[0]?.count ?? 0;
}

export function createAuditRepository(db: Executor): AuditRepository {
  return {
    record: (ctx, entry) => recordAudit(db, ctx, entry),
    recordSystem: (entry) => recordSystemAudit(db, entry),
    list: (workspaceId, options) => listAudit(db, workspaceId, options) as Promise<AuditRow[]>,
    countActions: (workspaceId, action) => countAuditActions(db, workspaceId, action),
  };
}
