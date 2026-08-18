import { addSource, listSourcesWithHealth } from '../../../../src/application/sources/manage';
import { ADAPTER_REGISTRY } from '../../../../src/adapters/sources/registry';
import { container } from '../../../../src/composition/container';
import { apiCreated, apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

const deps = () => {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock, secretBox: c.secretBox, adapters: c.adapters };
};

export const GET = readRoute('workspace.read', async ({ ctx }) => {
  const sources = await listSourcesWithHealth(deps(), ctx);

  return apiSuccess({
    sources,
    // The manifests are served alongside so the interface can render a
    // configuration form for any adapter without hardcoding one.
    available: [...ADAPTER_REGISTRY.values()].map((adapter) => adapter.manifest),
  });
});

export const POST = writeRoute('sources.configure', async ({ ctx, body }) => {
  const result = await addSource(deps(), ctx, body as never);
  return apiCreated(result);
});
