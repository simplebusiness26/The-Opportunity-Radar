/**
 * Every repository function and every use-case takes an actor context as its
 * first argument. There is no ambient "current user" and no global workspace:
 * tenancy is a parameter, which is why a cross-workspace read has to be written
 * deliberately rather than happening by omission.
 */

export type MemberRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface WorkspaceCtx {
  workspaceId: string;
  orgId: string;
  userId: string;
  role: MemberRole;
  requestId?: string;
  ipHash?: string;
}

/** Context for work performed by the scheduler or a job, with no human actor. */
export interface SystemCtx {
  workspaceId: string;
  orgId: string;
  actor: 'system' | 'job';
  jobId?: string;
  requestId?: string;
}

export type ActorCtx = WorkspaceCtx | SystemCtx;

export function isSystemCtx(ctx: ActorCtx): ctx is SystemCtx {
  return 'actor' in ctx;
}

export function actorUserId(ctx: ActorCtx): string | null {
  return isSystemCtx(ctx) ? null : ctx.userId;
}

export function actorKind(ctx: ActorCtx): 'user' | 'system' | 'job' {
  return isSystemCtx(ctx) ? ctx.actor : 'user';
}
