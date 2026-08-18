import { z } from 'zod';
import { errors } from '../../domain/types/errors';
import { slugify } from '../../domain/text/slug';
import type { AuthDeps, RequestMeta, SessionIssue } from './types';
import { SESSION_TTL_MS } from './types';

export const signUpInput = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  password: z
    .string()
    .min(12, 'Use at least 12 characters. Length matters more than symbols.')
    .max(1024),
  displayName: z.string().trim().min(1, 'Enter a name.').max(120),
  workspaceName: z.string().trim().min(1).max(120).default('My Workspace'),
});

export type SignUpInput = z.infer<typeof signUpInput>;

export interface SignUpResult {
  userId: string;
  workspaceId: string;
  session: SessionIssue;
}

/**
 * Creates the first account, its organisation and its default workspace in one
 * transaction, and signs the new owner in.
 *
 * With RADAR_SINGLE_OWNER set (the default for a self-hosted install) only one
 * account may ever be created, so an exposed instance cannot be joined by a
 * stranger who finds the sign-up page.
 */
export async function signUp(
  deps: AuthDeps,
  input: SignUpInput,
  meta: RequestMeta = {},
): Promise<SignUpResult> {
  const parsed = signUpInput.parse(input);
  const ipHash = meta.ip ? deps.tokens.hashIp(meta.ip, deps.ipSalt) : null;

  const limit = await deps.rateLimiter.check(`signup:${ipHash ?? 'unknown'}`, deps.limits.signUp);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds);

  if (deps.singleOwner && (await deps.repos.users.count()) > 0) {
    throw errors.forbidden(
      'auth.signup_closed',
      'This instance is configured for a single owner and already has an account.',
    );
  }

  if (await deps.repos.users.findByEmail(parsed.email)) {
    // Sign-up is not an oracle for existing accounts beyond what the owner
    // already knows; on a single-owner instance this branch is unreachable.
    throw errors.conflict('auth.email_taken', 'That email address is already registered.');
  }

  const password = await deps.passwords.hash(parsed.password);
  const now = deps.clock.now();
  const token = deps.tokens.generate();
  const csrfSecret = deps.tokens.generate();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const result = await deps.tx.transaction(async (repos) => {
    const user = await repos.users.insert({
      email: parsed.email,
      displayName: parsed.displayName,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordAlgo: password.algo,
    });

    const orgSlug = await repos.tenancy.uniqueSlug('orgs', parsed.workspaceName || parsed.displayName);
    const org = await repos.tenancy.createOrg(parsed.workspaceName, orgSlug);

    const workspaceSlug = await repos.tenancy.uniqueSlug(
      'workspaces',
      slugify(parsed.workspaceName) || 'workspace',
    );
    const workspace = await repos.tenancy.createWorkspace(org.id, parsed.workspaceName, workspaceSlug);

    await repos.tenancy.createMembership({
      orgId: org.id,
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
    });

    await repos.sessions.insert({
      userId: user.id,
      tokenHash: deps.tokens.hash(token),
      csrfSecret,
      activeWorkspaceId: workspace.id,
      expiresAt,
      ipHash,
      userAgent: meta.userAgent ?? null,
    });

    await repos.audit.record(
      {
        workspaceId: workspace.id,
        orgId: org.id,
        userId: user.id,
        role: 'owner',
        requestId: meta.requestId,
        ipHash: ipHash ?? undefined,
      },
      {
        action: 'auth.signed_up',
        entityType: 'user',
        entityId: user.id,
        after: { email: parsed.email, workspaceId: workspace.id },
      },
    );

    await repos.users.markSignedIn(user.id, now);

    return { userId: user.id, workspaceId: workspace.id };
  });

  return {
    ...result,
    session: { token, csrfToken: csrfSecret, expiresAt },
  };
}
