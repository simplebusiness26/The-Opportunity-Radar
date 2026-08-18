import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { auditLog, secrets } from '../schema/index';
import type { ActorCtx } from '../../../domain/types/identity';
import type { AuditEntry } from '../../../ports/repositories/audit';
import { actorKind, actorUserId } from '../../../domain/types/identity';
import type {
  AuditRepository,
  AuditRow,
  SecretRepository,
} from '../../../ports/repositories/audit';

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

export function createSecretRepository(db: Executor): SecretRepository {
  return {
    async put(workspaceId, input) {
      const [row] = await db
        .insert(secrets)
        .values({
          workspaceId,
          kind: input.kind,
          name: input.name,
          ciphertext: input.sealed.ciphertext,
          nonce: input.sealed.nonce,
          authTag: input.sealed.authTag,
          keyVersion: input.sealed.keyVersion,
          hint: input.sealed.hint,
        })
        .returning({ id: secrets.id });
      if (!row) throw new Error('put secret returned no row');
      return row;
    },

    async find(secretId) {
      const rows = await db.select().from(secrets).where(eq(secrets.id, secretId)).limit(1);
      const row = rows[0];
      return row
        ? {
            ciphertext: row.ciphertext,
            nonce: row.nonce,
            authTag: row.authTag,
            keyVersion: row.keyVersion,
            hint: row.hint ?? '',
          }
        : null;
    },

    async describe(workspaceId, kind) {
      // Deliberately never selects ciphertext: a stored credential has no route
      // back out through the API, only in.
      const rows = await db
        .select({ id: secrets.id, name: secrets.name, hint: secrets.hint })
        .from(secrets)
        .where(and(eq(secrets.workspaceId, workspaceId), eq(secrets.kind, kind)));
      return rows.map((row) => ({ id: row.id, name: row.name, hasValue: true, hint: row.hint }));
    },

    async remove(workspaceId, secretId) {
      await db
        .delete(secrets)
        .where(and(eq(secrets.workspaceId, workspaceId), eq(secrets.id, secretId)));
    },
  };
}
