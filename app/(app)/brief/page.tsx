import Link from 'next/link';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { DeltaBadge } from '../../../src/web/ui/score';

export const dynamic = 'force-dynamic';

interface BriefChange {
  opportunityId: string;
  title: string;
  from: number | null;
  to: number;
  delta: number;
  because: string;
}

export default async function BriefPage() {
  const { ctx } = await requireWorkspacePage('workspace.read');
  const c = container();
  const brief = await c.repos.briefs.latest(ctx.workspaceId);

  if (!brief) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-ink">Brief</h1>
        <Panel>
          <EmptyState title="No brief has been written yet">
            The brief is written once a day from what actually changed. It will appear after the
            first scheduled run, or as soon as something in the workspace moves.
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const metrics = brief.metrics as Record<string, number>;
  const sections = brief.sections as {
    strengthened?: BriefChange[];
    weakened?: BriefChange[];
    quiet?: boolean;
  };
  const bestMove = brief.bestMove as {
    title?: string;
    score?: number;
    confidence?: number;
    actionable?: boolean;
    recommendation?: string;
    opportunityId?: string;
  } | null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Brief</h1>
        <p className="mt-1 font-mono text-xs text-ink-faint">{brief.briefDate}</p>
      </div>

      <Panel>
        <PanelHeader title="What the machine did" />
        <div className="scroll-x px-4 py-3">
          <div className="flex min-w-max gap-5">
            {[
              ['scanned', metrics.signalsRecorded],
              ['unique evidence', metrics.uniqueEvidence],
              ['folded as repeats', metrics.duplicatesFolded],
              ['problems updated', metrics.clustersUpdated],
              ['strengthened', metrics.opportunitiesStrengthened],
              ['weakened', metrics.opportunitiesWeakened],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="font-mono text-lg text-ink">{Number(value ?? 0)}</p>
                <p className="font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {bestMove ? (
        <Panel>
          <PanelHeader title="Best move" />
          <div className="px-4 py-3">
            <Callout tone={bestMove.actionable ? 'positive' : 'caution'}>
              {bestMove.recommendation}
            </Callout>
            {bestMove.opportunityId ? (
              <Link
                href={`/opportunities/${bestMove.opportunityId}`}
                className="mt-3 inline-block text-sm text-accent hover:underline"
              >
                Open {bestMove.title} →
              </Link>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {sections.quiet ? (
        <Panel>
          <PanelHeader title="Changes" />
          <div className="px-4 py-3">
            <Callout tone="neutral">
              Nothing moved. A quiet day is reported as a quiet day rather than padded out.
            </Callout>
          </div>
        </Panel>
      ) : (
        <>
          {sections.strengthened?.length ? (
            <ChangeList title="Strengthened" changes={sections.strengthened} />
          ) : null}
          {sections.weakened?.length ? (
            <ChangeList title="Weakened" changes={sections.weakened} />
          ) : null}
        </>
      )}
    </div>
  );
}

function ChangeList({ title, changes }: { title: string; changes: BriefChange[] }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <ul className="divide-y divide-line">
        {changes.map((change) => (
          <li key={`${change.opportunityId}-${change.to}`} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/opportunities/${change.opportunityId}`}
                className="text-sm font-medium text-ink hover:text-accent"
              >
                {change.title}
              </Link>
              <DeltaBadge delta={change.delta} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {change.from === null ? 'First score' : `${Math.round(change.from)} → `}
              {Math.round(change.to)} because {change.because}.
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
