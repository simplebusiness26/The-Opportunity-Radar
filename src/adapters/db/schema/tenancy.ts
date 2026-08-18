import { relations } from 'drizzle-orm';
import { index, jsonb, pgEnum, text, uniqueIndex, uuid, pgTable } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';

/**
 * Tenancy exists from the first migration even though Radar starts as a
 * single-owner tool: every domain row carries `workspace_id`, so multi-user
 * support later is a permissions change, not a data migration.
 */

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'analyst', 'viewer']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended']);

export const orgs = pgTable(
  'orgs',
  {
    id: pk(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('orgs_slug_key').on(table.slug)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Workspace-level preferences: thresholds, dedupe config, display options. */
    settings: jsonb('settings').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('workspaces_org_slug_key').on(table.orgId, table.slug),
    index('workspaces_org_idx').on(table.orgId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    /** scrypt output; see src/adapters/crypto/password.ts. Never leaves the server. */
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    passwordAlgo: text('password_algo').notNull().default('scrypt-n32768-r8-p1'),
    displayName: text('display_name').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('viewer'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('memberships_workspace_user_key').on(table.workspaceId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque cookie token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** Per-session secret backing the double-submit CSRF token. */
    csrfSecret: text('csrf_secret').notNull(),
    activeWorkspaceId: uuid('active_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    /** Hashed, never the raw address — see docs/SECURITY.md on data minimisation. */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

export const orgsRelations = relations(orgs, ({ many }) => ({
  workspaces: many(workspaces),
  memberships: many(memberships),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  org: one(orgs, { fields: [workspaces.orgId], references: [orgs.id] }),
  memberships: many(memberships),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  org: one(orgs, { fields: [memberships.orgId], references: [orgs.id] }),
  workspace: one(workspaces, { fields: [memberships.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

