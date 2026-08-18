import type { ActorCtx, MemberRole } from './identity';
import { isSystemCtx } from './identity';

/**
 * Permissions are named after what the product lets a person do, not after
 * table names, so the meaning survives schema changes.
 */
export const PERMISSIONS = [
  'workspace.read',
  'workspace.manage',
  'members.manage',
  'signals.read',
  'signals.write',
  'clusters.write',
  'opportunities.read',
  'opportunities.write',
  'opportunities.decide',
  'intelligence.read',
  'intelligence.write',
  'experiments.write',
  'scoring.configure',
  'sources.configure',
  'ai.configure',
  'budget.configure',
  'jobs.operate',
  'audit.read',
  'secrets.write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  'workspace.read',
  'signals.read',
  'opportunities.read',
  'intelligence.read',
];

const ANALYST: Permission[] = [
  ...VIEWER,
  'signals.write',
  'clusters.write',
  'opportunities.write',
  'intelligence.write',
  'experiments.write',
];

/**
 * An admin runs the machine; only an owner may make the decisions that commit
 * the business -- accepting or killing an opportunity, and spending money.
 */
const ADMIN: Permission[] = [
  ...ANALYST,
  'scoring.configure',
  'sources.configure',
  'ai.configure',
  'jobs.operate',
  'audit.read',
  'secrets.write',
];

const OWNER: Permission[] = [
  ...ADMIN,
  'workspace.manage',
  'members.manage',
  'opportunities.decide',
  'budget.configure',
];

const BY_ROLE: Record<MemberRole, ReadonlySet<Permission>> = {
  viewer: new Set(VIEWER),
  analyst: new Set(ANALYST),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

export function permissionsFor(role: MemberRole): ReadonlySet<Permission> {
  return BY_ROLE[role];
}

/**
 * Background work is not a superuser. The scheduler may ingest, score and alert;
 * it may never take a decision that belongs to the owner, change budgets, or
 * touch credentials -- so a compromised source cannot escalate through a job.
 */
const SYSTEM_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'workspace.read',
  'signals.read',
  'signals.write',
  'clusters.write',
  'opportunities.read',
  'opportunities.write',
  'intelligence.read',
  'intelligence.write',
  'jobs.operate',
]);

export function can(ctx: ActorCtx, permission: Permission): boolean {
  if (isSystemCtx(ctx)) return SYSTEM_PERMISSIONS.has(permission);
  return BY_ROLE[ctx.role].has(permission);
}
