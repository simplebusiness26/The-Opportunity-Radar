import { configureFactory, readFactoryTarget } from '../../../../../src/application/execution/handoff';
import { container } from '../../../../../src/composition/container';
import { apiSuccess } from '../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('workspace.read', async ({ ctx }) => {
  const c = container();
  const target = await readFactoryTarget(c.repos, ctx.workspaceId);
  // The URL is returned; the token never is.
  return apiSuccess({ target, configured: target !== null });
});

export const POST = writeRoute('workspace.manage', async ({ ctx, body }) => {
  const c = container();
  const result = await configureFactory(
    { repos: c.repos, tx: c.tx, clock: c.clock, secretBox: c.secretBox },
    ctx,
    body as never,
  );
  return apiSuccess(result);
});
