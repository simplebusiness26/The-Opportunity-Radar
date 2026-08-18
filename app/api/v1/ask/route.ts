import { askRadar } from '../../../../src/pipeline/ask/answer';
import { container } from '../../../../src/composition/container';
import { askDependencies } from '../../../../src/composition/jobs';
import { apiSuccess } from '../../../../src/web/http/response';
import { writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * A POST rather than a GET, deliberately: the question stays out of URLs,
 * server logs and browser history, and it is never persisted.
 */
export const POST = writeRoute('opportunities.read', async ({ ctx, body }) => {
  const c = container();
  const question = String((body as { question?: unknown }).question ?? '');

  const result = await askRadar(askDependencies(c), ctx, question);
  return apiSuccess(result);
});
