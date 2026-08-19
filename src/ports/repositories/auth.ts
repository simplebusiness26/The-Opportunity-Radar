import type { MemberRole } from '../../domain/types/identity';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'suspended';
  passwordHash: string;
  passwordSalt: string;
  passwordAlgo: string;
}

export interface MembershipRecord {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  orgId: string;
  orgName: string;
  role: MemberRole;
}

export interface SessionRecord {
  id: string;
  userId: string;
  csrfSecret: string;
  activeWorkspaceId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  count(): Promise<number>;
  insert(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    passwordAlgo: string;
  }): Promise<UserRecord>;
  updatePassword(
    userId: string,
    input: { passwordHash: string; passwordSalt: string; passwordAlgo: string },
    now: Date,
  ): Promise<void>;
  markSignedIn(userId: string, now: Date): Promise<void>;
  listMemberships(userId: string): Promise<MembershipRecord[]>;
  findMembership(userId: string, workspaceId: string): Promise<MembershipRecord | null>;
}

export interface SessionRepository {
  insert(input: {
    userId: string;
    tokenHash: string;
    csrfSecret: string;
    activeWorkspaceId: string | null;
    expiresAt: Date;
    ipHash: string | null;
    userAgent: string | null;
  }): Promise<SessionRecord>;
  findLiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<(SessionRecord & { userStatus: 'active' | 'suspended' }) | null>;
  touch(sessionId: string, now: Date, expiresAt: Date): Promise<void>;
  setWorkspace(sessionId: string, workspaceId: string): Promise<void>;
  revoke(sessionId: string, now: Date): Promise<void>;
  revokeAllForUser(userId: string, now: Date): Promise<void>;
  deleteDead(before: Date): Promise<number>;
}

export interface WorkspaceSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
}

export interface TenancyRepository {
  createOrg(name: string, slug: string): Promise<{ id: string; name: string; slug: string }>;
  createWorkspace(orgId: string, name: string, slug: string): Promise<WorkspaceSummary>;
  createMembership(input: {
    orgId: string;
    workspaceId: string;
    userId: string;
    role: MemberRole;
  }): Promise<void>;
  findWorkspace(workspaceId: string): Promise<WorkspaceSummary | null>;
  /**
   * Returns the only workspace in a single-owner install. Returns null when
   * there are zero or multiple workspaces so a machine integration can never
   * silently guess which tenant it should mutate.
   */
  findOnlyWorkspace(): Promise<WorkspaceSummary | null>;
  updateSettings(workspaceId: string, settings: Record<string, unknown>, now: Date): Promise<void>;
  uniqueSlug(table: 'orgs' | 'workspaces', base: string): Promise<string>;
}
