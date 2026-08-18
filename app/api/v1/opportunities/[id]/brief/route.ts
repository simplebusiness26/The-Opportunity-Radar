import { buildExecutionBrief } from '../../../../../../src/application/execution/brief';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { readRoute } from '../../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

/**
 * The brief, as JSON or as the Markdown document.
 *
 * Markdown is the exportable form: it is what a person reads, what gets pasted
 * into a ticket, and what is posted to a receiving system, so there is exactly
 * one rendering rather than three that drift.
 */
export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const c = container();
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2]!;

  const { brief, markdown } = await buildExecutionBrief(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    id,
  );

  if (request.nextUrl.searchParams.get('format') === 'markdown') {
    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="execution-brief-${brief.input.reference}.md"`,
      },
    }) as never;
  }

  return apiSuccess({ brief, markdown });
});
