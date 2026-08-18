import type { ExecutionBrief } from '../../domain/execution/brief';
import type { HandoffRow } from '../../ports/repositories/execution';
import { Callout, Panel, PanelHeader } from '../ui/primitives';
import { HandoffActions } from './handoff-actions';

/**
 * The execution boundary, as it appears on an opportunity.
 *
 * The readiness verdict is shown before the export control, deliberately: the
 * point of the boundary is that something crossing it has survived the process,
 * and an owner overruling that should have read why first.
 */
export function HandoffPanel({
  opportunityId,
  brief,
  handoffs,
  target,
  canDecide,
  csrfToken,
}: {
  opportunityId: string;
  brief: ExecutionBrief;
  handoffs: HandoffRow[];
  target: string | null;
  canDecide: boolean;
  csrfToken: string;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Execution brief"
        hint={target ? `Delivers to ${safeHost(target)}` : 'Export only — no delivery target configured'}
      />

      <div className="space-y-3 px-4 py-3">
        {brief.readiness.ready ? (
          <Callout tone="positive" title="Ready to build">
            {brief.readiness.note}
          </Callout>
        ) : (
          <Callout tone="caution" title={brief.readiness.reason}>
            {brief.readiness.remedy}
          </Callout>
        )}

        <p className="text-sm text-ink-muted">
          The brief carries the thesis, the three evidence counts, what is assumed and unknown, the
          objections that survived, what was tested and against which thresholds, and what must not
          be built yet. Every figure in it is read from records.
        </p>

        <HandoffActions
          opportunityId={opportunityId}
          ready={brief.readiness.ready}
          canDecide={canDecide}
          csrfToken={csrfToken}
        />

        {handoffs.length > 0 ? (
          <ul className="divide-y divide-line border-t border-line">
            {handoffs.map((handoff) => (
              <li key={handoff.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm text-ink-muted">
                  {handoff.createdAt.toISOString().slice(0, 10)}
                  {handoff.target ? ` → ${safeHost(handoff.target)}` : ' (exported)'}
                </span>
                <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                  {handoff.status}
                  {handoff.lastError ? ` · ${handoff.lastError}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the configured target';
  }
}
