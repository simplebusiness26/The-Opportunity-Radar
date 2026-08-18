import type { ActorCtx } from '../../domain/types/identity';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditRow {
  id: string;
  workspaceId: string | null;
  actorKind: 'user' | 'system' | 'job';
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

/**
 * Append-only. There is deliberately no update or delete method: the audit log
 * is evidence, and evidence that can be rewritten is not evidence.
 */
export interface AuditRepository {
  record(ctx: ActorCtx, entry: AuditEntry): Promise<void>;
  /** For events that precede a workspace, such as sign-up and failed sign-in. */
  recordSystem(
    entry: AuditEntry & { requestId?: string; ipHash?: string; userId?: string },
  ): Promise<void>;
  list(
    workspaceId: string,
    options?: { limit?: number; action?: string; entityType?: string; entityId?: string },
  ): Promise<AuditRow[]>;
  countActions(workspaceId: string, action: string): Promise<number>;
}
