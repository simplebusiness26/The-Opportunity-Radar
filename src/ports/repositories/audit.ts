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

export interface SecretRepository {
  /** Stores a sealed credential and returns its id. */
  put(
    workspaceId: string,
    input: { kind: string; name: string; sealed: SealedSecretRow },
  ): Promise<{ id: string }>;
  find(secretId: string): Promise<SealedSecretRow | null>;
  /** Never returns ciphertext: only whether a value exists and its hint. */
  describe(
    workspaceId: string,
    kind: string,
  ): Promise<Array<{ id: string; name: string; hasValue: boolean; hint: string | null }>>;
  remove(workspaceId: string, secretId: string): Promise<void>;
}

export interface SealedSecretRow {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
  hint: string;
}
