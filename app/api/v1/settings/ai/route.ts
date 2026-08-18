import {
  connectProvider,
  setRoleRoute,
} from '../../../../../src/application/system/configure-ai';
import { container } from '../../../../../src/composition/container';
import { apiCreated, apiSuccess } from '../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

const deps = () => {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock, secretBox: c.secretBox };
};

export const GET = readRoute('ai.configure', async ({ ctx }) => {
  const c = container();
  const [providers, models, routes] = await Promise.all([
    c.repos.ai.listProviders(ctx.workspaceId),
    c.repos.ai.listModels(ctx.workspaceId),
    c.repos.ai.routes(ctx.workspaceId),
  ]);

  return apiSuccess({
    // Credentials never come back out: only whether one is stored.
    providers: providers.map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      label: provider.label,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      hasCredential: provider.secretId !== null,
      health: provider.health,
    })),
    models,
    routes,
  });
});

export const POST = writeRoute('ai.configure', async ({ ctx, body }) => {
  const input = (body ?? {}) as { action?: string };

  if (input.action === 'set_route') {
    await setRoleRoute(deps(), ctx, body as never);
    return apiSuccess({ updated: true });
  }

  const result = await connectProvider(deps(), ctx, body as never);
  return apiCreated(result);
});
