import { recordSignal } from '../../../../src/application/signals/record-signal';
import { container } from '../../../../src/composition/container';
import { apiCreated, apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('signals.read', async ({ request, ctx }) => {
  const params = request.nextUrl.searchParams;
  const c = container();

  const { rows, total } = await c.repos.signals.list(ctx.workspaceId, {
    search: params.get('q') ?? undefined,
    signalTypes: params.getAll('type') as never,
    evidenceClasses: params.getAll('class') as never,
    includeDemo: params.get('demo') === 'true',
    limit: Number(params.get('limit') ?? 50),
    offset: Number(params.get('offset') ?? 0),
  });

  return apiSuccess({ signals: rows, total });
});

export const POST = writeRoute('signals.write', async ({ ctx, body }) => {
  const c = container();
  const result = await recordSignal(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    body as never,
  );

  return apiCreated({
    signalId: result.signal.id,
    evidenceUnitId: result.evidenceUnitId,
    outcome: result.outcome,
    dedupeReason: result.dedupeReason,
    explanation: result.explanation,
  });
});
