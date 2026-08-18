import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { readModeStatus } from '../../../src/application/system/mode';
import { AskForm } from '../../../src/web/components/ask-form';

export const dynamic = 'force-dynamic';

export default async function AskPage() {
  const { ctx, session } = await requireWorkspacePage('opportunities.read');
  const c = container();
  const mode = await readModeStatus(c.repos, ctx.workspaceId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Ask Radar</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Questions about what this workspace has recorded. It answers from your own evidence and
          nothing else, cites every claim, and says so plainly when it cannot answer &mdash; which
          is the difference between this and asking a chatbot.
        </p>
      </div>

      <AskForm csrfToken={session?.csrfSecret ?? ''} aiConfigured={mode.mode !== 'manual'} />
    </div>
  );
}
