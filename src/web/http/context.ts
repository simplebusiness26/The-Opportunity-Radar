import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { errors } from '../../domain/types/errors';
import type { Permission } from '../../domain/types/permissions';
import { can } from '../../domain/types/permissions';
import type { WorkspaceCtx } from '../../domain/types/identity';
import { resolveSession, type ResolvedSession } from '../../application/auth/session';
import { isSafeMethod, verifyCsrfToken, verifyOrigin } from '../../domain/auth/csrf';
import { authDeps } from '../../composition/auth';
import { container } from '../../composition/container';

export const SESSION_COOKIE = '__Host-radar_session';
export const CSRF_HEADER = 'x-radar-csrf';

/**
 * `__Host-` prefixed cookies are locked to the exact origin and cannot be set
 * by a subdomain, which removes an entire class of session-fixation attack. The
 * prefix requires Secure, so plain-HTTP local development uses the plain name.
 */
export function sessionCookieName(publicUrl: string): string {
  return publicUrl.startsWith('https://') ? SESSION_COOKIE : 'radar_session';
}

export interface RequestContext {
  requestId: string;
  session: ResolvedSession | null;
  ctx: WorkspaceCtx | null;
}

export async function readRequestContext(): Promise<RequestContext> {
  const c = container();
  const headerBag = await headers();
  const cookieBag = await cookies();
  const requestId = headerBag.get('x-request-id') ?? randomUUID();

  const token = cookieBag.get(sessionCookieName(c.env.RADAR_PUBLIC_URL))?.value ?? null;
  const session = await resolveSession(authDeps(c), token, {
    requestId,
    userAgent: headerBag.get('user-agent') ?? undefined,
  });

  return { requestId, session, ctx: session?.ctx ?? null };
}

/**
 * The gate every mutating API route passes through.
 *
 * Order matters: origin first (cheapest and catches cross-site posts outright),
 * then the CSRF token, then authentication, then the specific permission. A
 * caller that fails any step learns only that it failed.
 */
export async function requireAuth(options: {
  permission?: Permission;
  method: string;
}): Promise<{ ctx: WorkspaceCtx; session: ResolvedSession; requestId: string }> {
  const c = container();
  const headerBag = await headers();
  const request = await readRequestContext();

  if (!isSafeMethod(options.method)) {
    const origin = verifyOrigin({
      method: options.method,
      origin: headerBag.get('origin'),
      secFetchSite: headerBag.get('sec-fetch-site'),
      expectedOrigin: c.env.RADAR_PUBLIC_URL,
    });
    if (!origin.ok) {
      throw errors.forbidden('csrf.origin_rejected', 'This request did not come from Radar.');
    }
  }

  if (!request.session) throw errors.unauthenticated();

  if (!isSafeMethod(options.method)) {
    const csrf = verifyCsrfToken(
      headerBag.get(CSRF_HEADER),
      request.session.csrfSecret,
      c.tokens.safeEqual,
    );
    if (!csrf.ok) {
      throw errors.forbidden('csrf.token_rejected', 'This request could not be verified.');
    }
  }

  if (!request.ctx) {
    throw errors.preconditionFailed(
      'workspace.none',
      'Your account is not attached to a workspace yet.',
      'Complete setup to create your first workspace.',
    );
  }

  if (options.permission && !can(request.ctx, options.permission)) {
    throw errors.forbidden('auth.insufficient_role', 'Your role does not allow this.');
  }

  return { ctx: request.ctx, session: request.session, requestId: request.requestId };
}

/** Read-only variant for GET route handlers, which return an error envelope. */
export async function requireWorkspace(permission?: Permission): Promise<{
  ctx: WorkspaceCtx;
  session: ResolvedSession;
}> {
  const request = await readRequestContext();
  if (!request.session) throw errors.unauthenticated();
  if (!request.ctx) {
    throw errors.preconditionFailed('workspace.none', 'No workspace is selected.', 'Complete setup.');
  }
  if (permission && !can(request.ctx, permission)) {
    throw errors.forbidden('auth.insufficient_role', 'Your role does not allow this.');
  }
  return { ctx: request.ctx, session: request.session };
}

/**
 * Page variant. Next renders a layout and its page concurrently, so a page that
 * threw would surface a server error before the layout's redirect landed. Pages
 * redirect instead, which is also what a person navigating expects.
 */
export async function requireWorkspacePage(permission?: Permission): Promise<{
  ctx: WorkspaceCtx;
  session: ResolvedSession;
}> {
  const request = await readRequestContext();
  if (!request.session) redirect('/sign-in');
  if (!request.ctx) redirect('/setup');
  if (permission && !can(request.ctx, permission)) redirect('/dashboard?denied=1');
  return { ctx: request.ctx, session: request.session };
}
