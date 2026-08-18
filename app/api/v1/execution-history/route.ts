import {
  readCalibration,
  recordExecutionOutcome,
} from '../../../../src/application/memory/execution';
import { container } from '../../../../src/composition/container';
import { apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('intelligence.read', async ({ ctx }) => {
  const c = container();
  const [history, calibration] = await Promise.all([
    c.repos.executionHistory.list(ctx.workspaceId, 100),
    readCalibration(c.repos, ctx.workspaceId),
  ]);

  return apiSuccess({ history, calibration });
});

export const POST = writeRoute('intelligence.write', async ({ ctx, body }) => {
  const c = container();
  const row = await recordExecutionOutcome(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    body as never,
  );
  return apiSuccess({ record: row });
});
