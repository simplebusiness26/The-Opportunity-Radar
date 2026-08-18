import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { container } from '../../../../../src/composition/container';
import { jobDependencies } from '../../../../../src/composition/jobs';
import { JOB_REGISTRY } from '../../../../../src/jobs/handlers/index';
import { tick } from '../../../../../src/jobs/tick';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';
import { errors } from '../../../../../src/domain/types/errors';
import { safeEqual } from '../../../../../src/adapters/crypto/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Runs one pass of the machine.
 *
 * This exists so a deployment that cannot keep a process alive -- Vercel, a
 * GitHub Action, a systemd timer -- gets exactly the same autonomy as one that
 * can. It is authenticated by a bearer token rather than a session, because the
 * caller is a scheduler, not a person.
 *
 * With no token configured the endpoint is disabled outright rather than left
 * open, so an accidental deployment cannot be driven by strangers.
 */
export async function POST(request: NextRequest) {
  try {
    const c = container();

    if (!c.env.RADAR_TICK_TOKEN) {
      throw errors.notConfigured(
        'tick.not_configured',
        'The tick endpoint is disabled.',
        'Set RADAR_TICK_TOKEN to enable scheduler-driven runs, or run `npm run worker` instead.',
      );
    }

    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!supplied || !safeEqual(supplied, c.env.RADAR_TICK_TOKEN)) {
      throw errors.unauthenticated('Invalid tick token.');
    }

    const body = (await request.json().catch(() => ({}))) as {
      maxJobs?: number;
      budgetMs?: number;
    };

    const result = await tick(
      {
        repos: c.repos,
        tx: c.tx,
        clock: c.clock,
        registry: JOB_REGISTRY,
        workerId: `tick-${randomUUID().slice(0, 8)}`,
        ...jobDependencies(c),
      },
      {
        maxJobs: Math.min(body.maxJobs ?? 25, 200),
        // Kept under the platform's request limit so the pass returns rather
        // than being killed mid-job.
        budgetMs: Math.min(body.budgetMs ?? 25_000, 50_000),
      },
    );

    return apiSuccess(result);
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
