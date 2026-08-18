import { resolveCapability } from '../../../../../../src/domain/taxonomy/capabilities';
import { assessOpportunityFit } from '../../../../../../src/application/intelligence/capability-profile';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../../src/web/http/route';
import { errors } from '../../../../../../src/domain/types/errors';

export const dynamic = 'force-dynamic';

function opportunityIdFrom(pathname: string): string {
  const id = pathname.split('/').filter(Boolean).at(-2);
  if (!id) throw errors.notFound('Opportunity');
  return id;
}

const deps = () => {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock };
};

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const opportunityId = opportunityIdFrom(request.nextUrl.pathname);
  const c = container();

  const [requirements, assessment] = await Promise.all([
    c.repos.opportunities.capabilityRequirements(opportunityId),
    assessOpportunityFit(deps(), ctx, opportunityId),
  ]);

  return apiSuccess({ requirements, leverage: assessment.leverage, fit: assessment.fit });
});

/**
 * Records what an opportunity would need. Each requirement is resolved against
 * the shared vocabulary here, and anything that will not resolve is stored with
 * its original wording and reported as a gap rather than mapped to a guess.
 */
export const PUT = writeRoute('opportunities.write', async ({ request, ctx, body }) => {
  const opportunityId = opportunityIdFrom(request.nextUrl.pathname);
  const input = (body ?? {}) as {
    requirements?: Array<{ label: string; criticality?: 'nice_to_have' | 'important' | 'essential' }>;
  };

  const resolved = (input.requirements ?? []).map((requirement) => {
    const resolution = resolveCapability(requirement.label);
    return {
      label: requirement.label,
      taxonomyKey: resolution.key,
      criticality: requirement.criticality ?? ('important' as const),
      resolvedBy: resolution.method,
    };
  });

  const c = container();
  await c.repos.opportunities.setCapabilityRequirements(ctx.workspaceId, opportunityId, resolved);
  await c.repos.audit.record(ctx, {
    action: 'opportunity.requirements_set',
    entityType: 'opportunity',
    entityId: opportunityId,
    after: { count: resolved.length },
  });

  const assessment = await assessOpportunityFit(deps(), ctx, opportunityId);

  return apiSuccess({
    requirements: resolved,
    leverage: assessment.leverage,
    fit: assessment.fit,
    unresolved: resolved.filter((requirement) => requirement.taxonomyKey === null).map((r) => r.label),
  });
});
