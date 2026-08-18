import { errors } from '../../domain/types/errors';
import type { MemberRole, WorkspaceCtx } from '../../domain/types/identity';
import type { MembershipRecord } from '../../ports/repositories/auth';
import type { AuthDeps, RequestMeta } from './types';
import { SESSION_REFRESH_AFTER_MS, SESSION_TTL_MS } from './types';

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  csrfSecret: string;
  memberships: MembershipRecord[];
  /** Null when the account exists but belongs to no workspace yet. */
  ctx: WorkspaceCtx | null;
}

/**
 * Turns a session cookie into an authorisation context.
 *
 * The workspace comes from the session row and is re-checked against a live
 * membership on every request, so revoking access takes effect immediately
 * rather than when the cookie eventually expires.
 */
export async function resolveSession(
  deps: AuthDeps,
  token: string | null | undefined,
  meta: RequestMeta = {},
): Promise<ResolvedSession | null> {
  if (!token) return null;

  const now = deps.clock.now();
  const session = await deps.repos.sessions.findLiveByTokenHash(deps.tokens.hash(token), now);
  if (!session || session.userStatus !== 'active') return null;

  const memberships = await deps.repos.users.listMemberships(session.userId);
  const active =
    memberships.find((m) => m.workspaceId === session.activeWorkspaceId) ?? memberships[0] ?? null;

  // Sliding expiry, written only when it has actually moved, so an active
  // session does not generate a write on every single request.
  const remaining = session.expiresAt.getTime() - now.getTime();
  if (remaining < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) {
    await deps.repos.sessions.touch(session.id, now, new Date(now.getTime() + SESSION_TTL_MS));
  }

  return {
    sessionId: session.id,
    userId: session.userId,
    csrfSecret: session.csrfSecret,
    memberships,
    ctx: active
      ? {
          workspaceId: active.workspaceId,
          orgId: active.orgId,
          userId: session.userId,
          role: active.role as MemberRole,
          requestId: meta.requestId,
        }
      : null,
  };
}

export async function signOut(deps: AuthDeps, sessionId: string): Promise<void> {
  await deps.repos.sessions.revoke(sessionId, deps.clock.now());
}

/** Switches which workspace a session is acting in, after re-checking access. */
export async function switchWorkspace(
  deps: AuthDeps,
  session: ResolvedSession,
  workspaceId: string,
): Promise<WorkspaceCtx> {
  const membership = await deps.repos.users.findMembership(session.userId, workspaceId);
  if (!membership) throw errors.forbidden('workspace.no_access', 'You are not a member of that workspace.');

  await deps.repos.sessions.setWorkspace(session.sessionId, workspaceId);

  return {
    workspaceId: membership.workspaceId,
    orgId: membership.orgId,
    userId: session.userId,
    role: membership.role,
  };
}
