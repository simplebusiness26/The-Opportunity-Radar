import { recordResource } from '../../../../../src/application/intelligence/capability-profile';
import { container } from '../../../../../src/composition/container';
import { apiCreated, apiSuccess } from '../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

const deps = () => {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock };
};

export const GET = readRoute('intelligence.read', async ({ ctx }) =>
  apiSuccess({ resources: await container().repos.graph.listResources(ctx.workspaceId) }),
);

export const POST = writeRoute('intelligence.write', async ({ ctx, body }) => {
  const result = await recordResource(deps(), ctx, body as never);
  return apiCreated(result);
});
