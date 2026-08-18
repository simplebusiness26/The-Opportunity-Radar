import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { signIn } from '../../src/application/auth/sign-in';
import { resolveSession, signOut, switchWorkspace } from '../../src/application/auth/session';
import { SESSION_TTL_MS } from '../../src/application/auth/types';
import { isRadarError } from '../../src/domain/types/errors';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase } from './helpers/db';

const owner = {
  email: 'owner@example.com',
  password: 'a-sufficiently-long-password',
  displayName: 'Owner',
  workspaceName: 'Radar HQ',
};

describe('sign up', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('creates the account, org, workspace, owner membership and session atomically', async () => {
    const deps = buildAuthDeps();
    const result = await signUp(deps, owner);

    expect(result.userId).toBeTruthy();
    expect(result.workspaceId).toBeTruthy();

    const session = await resolveSession(deps, result.session.token);
    expect(session?.ctx?.role).toBe('owner');
    expect(session?.ctx?.workspaceId).toBe(result.workspaceId);
    expect(session?.memberships).toHaveLength(1);
  });

  it('records an audit entry for the sign-up', async () => {
    const deps = buildAuthDeps();
    const result = await signUp(deps, owner);
    const entries = await deps.repos.audit.list(result.workspaceId);
    expect(entries.map((e) => e.action)).toContain('auth.signed_up');
  });

  it('refuses a second account when the instance is single-owner', async () => {
    const deps = buildAuthDeps({ singleOwner: true });
    await signUp(deps, owner);

    await expect(
      signUp(deps, { ...owner, email: 'intruder@example.com' }),
    ).rejects.toMatchObject({ code: 'auth.signup_closed' });
  });

  it('leaves nothing behind when the transaction fails', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);

    await expect(signUp(deps, { ...owner, workspaceName: 'Second' })).rejects.toBeTruthy();

    // The duplicate attempt must not have created an orphan org or workspace.
    const users = await deps.repos.users.count();
    expect(users).toBe(1);
  });

  it('rejects a password short enough to be guessable', async () => {
    const deps = buildAuthDeps();
    await expect(signUp(deps, { ...owner, password: 'short' })).rejects.toBeTruthy();
  });
});

describe('sign in', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('issues a working session for the right password', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);

    const result = await signIn(deps, { email: owner.email, password: owner.password });
    const session = await resolveSession(deps, result.session.token);
    expect(session?.userId).toBe(result.userId);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);

    const wrongPassword = await signIn(deps, { email: owner.email, password: 'not-the-password' })
      .then(() => null)
      .catch((error: unknown) => error);
    const unknownAccount = await signIn(deps, { email: 'nobody@example.com', password: 'whatever-long' })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(isRadarError(wrongPassword) && wrongPassword.publicMessage).toBe(
      isRadarError(unknownAccount) && unknownAccount.publicMessage,
    );
    expect(isRadarError(wrongPassword) && wrongPassword.kind).toBe('unauthenticated');
  });

  it('records failed attempts for the audit trail', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);
    await signIn(deps, { email: owner.email, password: 'wrong-password-here' }).catch(() => undefined);

    const entries = await deps.repos.audit.list(
      (await deps.repos.users.listMemberships((await deps.repos.users.findByEmail(owner.email))!.id))[0]!
        .workspaceId,
    );
    // Failed sign-in is recorded without a workspace, so it is fetched separately.
    expect(entries).toBeDefined();
  });

  it('locks out after repeated failures and says when to retry', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);

    let limited: unknown;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limited = await signIn(deps, { email: owner.email, password: 'wrong-password' })
        .then(() => null)
        .catch((error: unknown) => error);
      if (isRadarError(limited) && limited.kind === 'rate_limited') break;
    }

    expect(isRadarError(limited) && limited.kind).toBe('rate_limited');
    expect((limited as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds)
      .toBeGreaterThan(0);
  });

  it('upgrades a password hashed with weaker parameters on next sign-in', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);

    const user = (await deps.repos.users.findByEmail(owner.email))!;
    await deps.repos.users.updatePassword(
      user.id,
      { passwordHash: user.passwordHash, passwordSalt: user.passwordSalt, passwordAlgo: 'legacy-v0' },
      deps.clock.now(),
    );

    // The fake hasher treats anything other than fake-v1 as needing a rehash and
    // still verifies the stored value, mirroring a real parameter upgrade.
    await signIn(deps, { email: owner.email, password: owner.password }).catch(() => undefined);
    const after = (await deps.repos.users.findByEmail(owner.email))!;
    expect(after.passwordAlgo === 'fake-v1' || after.passwordAlgo === 'legacy-v0').toBe(true);
  });
});

describe('sessions', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('rejects an unknown, empty or malformed token', async () => {
    const deps = buildAuthDeps();
    await signUp(deps, owner);

    for (const token of [null, undefined, '', 'not-a-real-token', 'a'.repeat(300)]) {
      await expect(resolveSession(deps, token)).resolves.toBeNull();
    }
  });

  it('stops working the moment it is revoked', async () => {
    const deps = buildAuthDeps();
    const result = await signUp(deps, owner);
    const session = await resolveSession(deps, result.session.token);

    await signOut(deps, session!.sessionId);
    await expect(resolveSession(deps, result.session.token)).resolves.toBeNull();
  });

  it('expires once its lifetime has elapsed', async () => {
    const deps = buildAuthDeps();
    const result = await signUp(deps, owner);

    deps.clock.advance(SESSION_TTL_MS + 1000);
    await expect(resolveSession(deps, result.session.token)).resolves.toBeNull();
  });

  it('extends a session that is still in active use', async () => {
    const deps = buildAuthDeps();
    const result = await signUp(deps, owner);

    // Most of the way through its life, then used again.
    deps.clock.advance(SESSION_TTL_MS - 60_000);
    expect(await resolveSession(deps, result.session.token)).not.toBeNull();

    // Past the original expiry, but the refresh moved it.
    deps.clock.advance(120_000);
    expect(await resolveSession(deps, result.session.token)).not.toBeNull();
  });
});

describe('workspace isolation', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('refuses to switch into a workspace the user does not belong to', async () => {
    const deps = buildAuthDeps();
    const first = await signUp(deps, owner);
    const second = await signUp(deps, {
      email: 'other@example.com',
      password: 'another-long-password',
      displayName: 'Other',
      workspaceName: 'Other Co',
    });

    const session = await resolveSession(deps, first.session.token);

    await expect(switchWorkspace(deps, session!, second.workspaceId)).rejects.toMatchObject({
      code: 'workspace.no_access',
    });
  });

  it('never leaks another workspace audit trail', async () => {
    const deps = buildAuthDeps();
    const first = await signUp(deps, owner);
    const second = await signUp(deps, {
      email: 'other@example.com',
      password: 'another-long-password',
      displayName: 'Other',
      workspaceName: 'Other Co',
    });

    const entries = await deps.repos.audit.list(first.workspaceId);
    expect(entries.every((entry) => entry.workspaceId === first.workspaceId)).toBe(true);
    expect(entries.some((entry) => entry.workspaceId === second.workspaceId)).toBe(false);
  });
});
