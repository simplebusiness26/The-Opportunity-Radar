import { index, jsonb, pgEnum, text, uuid, pgTable } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { users, workspaces } from './tenancy';

export const actorKindEnum = pgEnum('actor_kind', ['user', 'system', 'job']);

/**
 * Append-only record of every state-changing action. Enforced by convention in
 * the repository layer plus a test that walks every mutating use-case and
 * asserts it writes a row here.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Machine-readable verb, e.g. `opportunity.state_changed`. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_log_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_action_idx').on(table.action),
  ],
);

/**
 * Encrypted credential storage. The API exposes only `hasValue` and a masked
 * hint; ciphertext never crosses the network boundary.
 */
export const secrets = pgTable(
  'secrets',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** e.g. `ai_provider`, `source`, `system`. */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    authTag: text('auth_tag').notNull(),
    keyVersion: text('key_version').notNull().default('v1'),
    /** Last four characters of the plaintext, for owner recognition only. */
    hint: text('hint'),
    createdAt: createdAt(),
  },
  (table) => [index('secrets_workspace_kind_idx').on(table.workspaceId, table.kind, table.name)],
);
