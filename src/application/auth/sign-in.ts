import { z } from 'zod';
import { errors } from '../../domain/types/errors';
import type { AuthDeps, RequestMeta, SessionIssue } from './types';
import { SESSION_TTL_MS } from './types';

export const signInInput = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024),
});

export type SignInInput = z.infer<typeof signInInput>;

export interface SignInResult {
  userId: string;
  workspaceId: string | null;
  session: SessionIssue;
}

/**
 * Verifies a password and issues a session.
 *
 * Failures are deliberately uniform: the same message and roughly the same cost
 * whether the account is unknown, suspended, or the password is wrong. A missing
 * account still performs a dummy hash so response timing does not reveal which
 * addresses are registered.
 */
export async function signIn(
  deps: AuthDeps,
  input: SignInInput,
  meta: RequestMeta = {},
): Promise<SignInResult> {
  const parsed = signInInput.parse(input);
  const ipHash = meta.ip ? deps.tokens.hashIp(meta.ip, deps.ipSalt) : null;

  // Limited by address and by account, so one attacker cannot lock the owner
  // out by hammering their email from many addresses, and vice versa.
  for (const key of [`signin:ip:${ipHash ?? 'unknown'}`, `signin:email:${parsed.email}`]) {
    const limit = await deps.rateLimiter.check(key, deps.limits.signIn);
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds);
  }

  const invalid = errors.unauthenticated('That email address and password do not match.');
  const user = await deps.repos.users.findByEmail(parsed.email);

  if (!user) {
    await deps.passwords.dummyVerify();
    await deps.repos.audit.recordSystem({
      action: 'auth.sign_in_failed',
      entityType: 'user',
      after: { reason: 'unknown_account' },
      requestId: meta.requestId,
      ipHash: ipHash ?? undefined,
    });
    throw invalid;
  }

  const passwordOk = await deps.passwords.verify(parsed.password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    algo: user.passwordAlgo,
  });

  if (!passwordOk || user.status !== 'active') {
    await deps.repos.audit.recordSystem({
      action: 'auth.sign_in_failed',
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      after: { reason: passwordOk ? 'account_suspended' : 'bad_password' },
      requestId: meta.requestId,
      ipHash: ipHash ?? undefined,
    });
    throw invalid;
  }

  const now = deps.clock.now();
  const token = deps.tokens.generate();
  const csrfSecret = deps.tokens.generate();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const memberships = await deps.repos.users.listMemberships(user.id);
  const activeWorkspaceId = memberships[0]?.workspaceId ?? null;

  await deps.tx.transaction(async (repos) => {
    await repos.sessions.insert({
      userId: user.id,
      tokenHash: deps.tokens.hash(token),
      csrfSecret,
      activeWorkspaceId,
      expiresAt,
      ipHash,
      userAgent: meta.userAgent ?? null,
    });

    // Cost parameters can be raised over time; existing users are upgraded on
    // their next successful sign-in rather than being forced to reset.
    if (deps.passwords.needsRehash(user.passwordAlgo)) {
      const upgraded = await deps.passwords.hash(parsed.password);
      await repos.users.updatePassword(
        user.id,
        { passwordHash: upgraded.hash, passwordSalt: upgraded.salt, passwordAlgo: upgraded.algo },
        now,
      );
    }

    await repos.users.markSignedIn(user.id, now);
    await repos.audit.recordSystem({
      action: 'auth.signed_in',
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      requestId: meta.requestId,
      ipHash: ipHash ?? undefined,
    });
  });

  await deps.rateLimiter.reset(`signin:email:${parsed.email}`);

  return { userId: user.id, workspaceId: activeWorkspaceId, session: { token, csrfToken: csrfSecret, expiresAt } };
}
