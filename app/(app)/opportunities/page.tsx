import Link from 'next/link';
import { OPPORTUNITY_TYPES } from '../../../src/domain/taxonomy/opportunity-types';
import { Button, DemoBadge, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { ScorePair, StateChip } from '../../../src/web/ui/score';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  const { ctx } = await requireWorkspacePage('opportunities.read');
  const c = container();

  const rows = await c.repos.opportunities.list(ctx.workspaceId, { includeDemo: true });
  const scores = await c.repos.scores.currentForMany(ctx.workspaceId, rows.map((row) => row.id));

  // Ranked by score, but anything unscored sorts last rather than as a zero.
  const ranked = [...rows].sort((a, b) => {
    const left = scores.get(a.id)?.attractiveness ?? -1;
    const right = scores.get(b.id)?.attractiveness ?? -1;
    return right - left;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Opportunities</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Where effort could go. Score and confidence are shown separately, always.
          </p>
        </div>
        <Link href="/opportunities/new">
          <Button>New opportunity</Button>
        </Link>
      </div>

      <Panel>
        <PanelHeader title={`${rows.length} ${rows.length === 1 ? 'opportunity' : 'opportunities'}`} />
        {ranked.length === 0 ? (
          <EmptyState
            title="Nothing under consideration"
            action={
              <Link href="/opportunities/new">
                <Button variant="secondary">Create one</Button>
              </Link>
            }
          >
            An opportunity is a specific problem, a specific customer, and a reason to believe
            something could be exchanged for solving it. Record evidence first if you have none.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {ranked.map((opportunity) => {
              const score = scores.get(opportunity.id);
              const type = OPPORTUNITY_TYPES[opportunity.typeKey];
              return (
                <li key={opportunity.id}>
                  <Link
                    href={`/opportunities/${opportunity.id}`}
                    className="block px-4 py-4 hover:bg-surface-raised"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-ink-faint">
                            #{opportunity.reference}
                          </span>
                          <StateChip state={opportunity.state} />
                          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                            {type?.label ?? opportunity.typeKey}
                          </span>
                          {opportunity.demo ? <DemoBadge /> : null}
                        </div>
                        <p className="mt-1.5 text-sm font-medium text-ink">{opportunity.title}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{opportunity.thesis}</p>
                      </div>
                      <div className="shrink-0">
                        {score ? (
                          <ScorePair
                            attractiveness={score.attractiveness}
                            confidence={score.confidence}
                          />
                        ) : (
                          <p className="font-mono text-xs text-ink-faint">not scored</p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
