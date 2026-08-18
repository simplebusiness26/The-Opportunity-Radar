import { EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { requireWorkspacePage } from '../../../src/web/http/context';

export const dynamic = 'force-dynamic';

/**
 * The dashboard proper -- best move, top opportunities, what changed, machine
 * status -- is built with the opportunity engine. Until those engines exist it
 * says so plainly rather than rendering placeholder numbers.
 */
export default async function DashboardPage() {
  await requireWorkspacePage('workspace.read');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Radar</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What deserves attention, why, and what changed since you last looked.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Best move right now" />
        <EmptyState title="No evidence yet">
          Radar has nothing to recommend because nothing has been observed. That is the correct
          answer, not a gap: recommendations appear once there is evidence behind them.
        </EmptyState>
      </Panel>
    </div>
  );
}
