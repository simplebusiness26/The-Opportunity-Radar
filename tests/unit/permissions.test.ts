import { describe, expect, it } from 'vitest';
import { PERMISSIONS, can, permissionsFor } from '../../src/domain/types/permissions';
import type { SystemCtx, WorkspaceCtx } from '../../src/domain/types/identity';

const user = (role: WorkspaceCtx['role']): WorkspaceCtx => ({
  workspaceId: 'w1',
  orgId: 'o1',
  userId: 'u1',
  role,
});

const system: SystemCtx = { workspaceId: 'w1', orgId: 'o1', actor: 'system' };

describe('role permissions', () => {
  it('grants strictly more with each step up the role ladder', () => {
    const viewer = permissionsFor('viewer');
    const analyst = permissionsFor('analyst');
    const admin = permissionsFor('admin');
    const owner = permissionsFor('owner');

    for (const p of viewer) expect(analyst.has(p)).toBe(true);
    for (const p of analyst) expect(admin.has(p)).toBe(true);
    for (const p of admin) expect(owner.has(p)).toBe(true);

    expect(owner.size).toBeGreaterThan(admin.size);
    expect(admin.size).toBeGreaterThan(analyst.size);
    expect(analyst.size).toBeGreaterThan(viewer.size);
  });

  it('never lets a viewer write anything', () => {
    for (const permission of PERMISSIONS) {
      if (permission.endsWith('.read')) continue;
      expect(can(user('viewer'), permission)).toBe(false);
    }
  });

  it('reserves business-committing decisions for the owner', () => {
    for (const permission of ['opportunities.decide', 'budget.configure', 'members.manage'] as const) {
      expect(can(user('owner'), permission)).toBe(true);
      expect(can(user('admin'), permission)).toBe(false);
      expect(can(user('analyst'), permission)).toBe(false);
    }
  });

  it('gives the owner every declared permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can(user('owner'), permission)).toBe(true);
    }
  });
});

describe('background work is not a superuser', () => {
  /**
   * The system context is what a compromised or manipulated source would act
   * through. It must not be able to reach credentials, budgets, or the owner's
   * decisions -- otherwise prompt injection becomes privilege escalation.
   */
  it('denies the system context every escalation-shaped permission', () => {
    for (const permission of [
      'secrets.write',
      'ai.configure',
      'budget.configure',
      'sources.configure',
      'members.manage',
      'workspace.manage',
      'opportunities.decide',
      'scoring.configure',
      'audit.read',
    ] as const) {
      expect(can(system, permission)).toBe(false);
    }
  });

  it('allows the system context the pipeline work it actually performs', () => {
    for (const permission of [
      'signals.write',
      'clusters.write',
      'opportunities.write',
      'intelligence.write',
      'jobs.operate',
    ] as const) {
      expect(can(system, permission)).toBe(true);
    }
  });
});
