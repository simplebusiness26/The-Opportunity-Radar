import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { memberships, orgs, sessions, users, workspaces } from '../schema/index';
import type {
  MembershipRecord,
  SessionRecord,
  SessionRepository,
  UserRecord,
  UserRepository,
} from '../../../ports/repositories/auth';

export async function findUserByEmail(db: Executor, email: string): Promise<UserRecord | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      passwordHash: users.passwordHash,
      passwordSalt: users.passwordSalt,
      passwordAlgo: users.passwordAlgo,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function countUsers(db: Executor): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return rows[0]?.count ?? 0;
}

export async function insertUser(
  db: Executor,
  input: {
    email: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    passwordAlgo: string;
  },
): Promise<UserRecord> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      passwordAlgo: input.passwordAlgo,
    })
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      passwordHash: users.passwordHash,
      passwordSalt: users.passwordSalt,
      passwordAlgo: users.passwordAlgo,
    });
  if (!row) throw new Error('insertUser returned no row');
  return row;
}

export async function updateUserPassword(
  db: Executor,
  userId: string,
  input: { passwordHash: string; passwordSalt: string; passwordAlgo: string },
  now: Date,
): Promise<void> {
  await db
    .update(users)
    .set({ ...input, updatedAt: now })
    .where(eq(users.id, userId));
}

export async function markUserSignedIn(db: Executor, userId: string, now: Date): Promise<void> {
  await db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, userId));
}

export async function listMembershipsForUser(
  db: Executor,
  userId: string,
): Promise<MembershipRecord[]> {
  return db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      orgId: orgs.id,
      orgName: orgs.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .innerJoin(orgs, eq(memberships.orgId, orgs.id))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.name);
}

export async function findMembership(
  db: Executor,
  userId: string,
  workspaceId: string,
): Promise<MembershipRecord | null> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      orgId: orgs.id,
      orgName: orgs.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .innerJoin(orgs, eq(memberships.orgId, orgs.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertSession(
  db: Executor,
  input: {
    userId: string;
    tokenHash: string;
    csrfSecret: string;
    activeWorkspaceId: string | null;
    expiresAt: Date;
    ipHash: string | null;
    userAgent: string | null;
  },
): Promise<SessionRecord> {
  const [row] = await db
    .insert(sessions)
    .values(input)
    .returning({
      id: sessions.id,
      userId: sessions.userId,
      csrfSecret: sessions.csrfSecret,
      activeWorkspaceId: sessions.activeWorkspaceId,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    });
  if (!row) throw new Error('insertSession returned no row');
  return row;
}

export async function findLiveSessionByTokenHash(
  db: Executor,
  tokenHash: string,
  now: Date,
): Promise<(SessionRecord & { userStatus: 'active' | 'suspended' }) | null> {
  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      csrfSecret: sessions.csrfSecret,
      activeWorkspaceId: sessions.activeWorkspaceId,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userStatus: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        sql`${sessions.revokedAt} is null`,
        sql`${sessions.expiresAt} > ${now}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function touchSession(
  db: Executor,
  sessionId: string,
  now: Date,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: now, expiresAt })
    .where(eq(sessions.id, sessionId));
}

export async function setSessionWorkspace(
  db: Executor,
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  await db.update(sessions).set({ activeWorkspaceId: workspaceId }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(db: Executor, sessionId: string, now: Date): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessionsForUser(
  db: Executor,
  userId: string,
  now: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} is null`));
}

/** Housekeeping: expired and revoked sessions are purged by a scheduled job. */
export async function deleteDeadSessions(db: Executor, before: Date): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < ${before} or ${sessions.revokedAt} is not null`)
    .returning({ id: sessions.id });
  return result.length;
}

/** Binds the query functions above to an executor, satisfying the port. */
export function createUserRepository(db: Executor): UserRepository {
  return {
    findByEmail: (email) => findUserByEmail(db, email),
    count: () => countUsers(db),
    insert: (input) => insertUser(db, input),
    updatePassword: (userId, input, now) => updateUserPassword(db, userId, input, now),
    markSignedIn: (userId, now) => markUserSignedIn(db, userId, now),
    listMemberships: (userId) => listMembershipsForUser(db, userId),
    findMembership: (userId, workspaceId) => findMembership(db, userId, workspaceId),
  };
}

export function createSessionRepository(db: Executor): SessionRepository {
  return {
    insert: (input) => insertSession(db, input),
    findLiveByTokenHash: (tokenHash, now) => findLiveSessionByTokenHash(db, tokenHash, now),
    touch: (sessionId, now, expiresAt) => touchSession(db, sessionId, now, expiresAt),
    setWorkspace: (sessionId, workspaceId) => setSessionWorkspace(db, sessionId, workspaceId),
    revoke: (sessionId, now) => revokeSession(db, sessionId, now),
    revokeAllForUser: (userId, now) => revokeAllSessionsForUser(db, userId, now),
    deleteDead: (before) => deleteDeadSessions(db, before),
  };
}
