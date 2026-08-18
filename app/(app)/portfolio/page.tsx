import Link from 'next/link';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import {
  allocateResources,
  compareScenarios,
} from '../../../src/application/intelligence/allocate-resources';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const { ctx } = await requireWorkspacePage('opportunities.read');
  const c = container();
  const deps = { repos: c.repos, tx: c.tx, clock: c.clock };

  const [thisWeek, scenarios] = await Promise.all([
    allocateResources(deps, ctx, { horizonDays: 7 }),
    compareScenarios(deps, ctx, [
      { label: 'A weekend and £50', horizonDays: 2, budgetOverride: 50, daysOverride: 2 },
      { label: 'A week, current resources', horizonDays: 7 },
      { label: 'A month and £500', horizonDays: 30, budgetOverride: 500, daysOverride: 20 },
    ]),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Portfolio</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Competing uses of the next stretch of effort, ranked by expected return per day. Building
          a new product is only one of the options, and often not the best one.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Best use of the next 7 days" />
        <div className="px-4 py-3">
          {thisWeek.recommendation ? (
            <>
              <Callout tone="positive" title={thisWeek.recommendation.title}>
                {thisWeek.recommendation.rationale}
              </Callout>
              <p className="mt-2 text-sm text-ink-muted">{thisWeek.explanation}</p>
            </>
          ) : (
            <Callout tone="caution" title="Nothing warrants committing the week">
              {thisWeek.noActionReason}
            </Callout>
          )}
        </div>
      </Panel>

      {thisWeek.notYet.length > 0 ? (
        <Panel>
          <PanelHeader title="Do not build yet" hint="Attractive, but not yet evidenced enough." />
          <ul className="divide-y divide-line">
            {thisWeek.notYet.map((entry) => (
              <li key={entry.title} className="px-4 py-2.5">
                <p className="text-sm font-medium text-ink">{entry.title}</p>
                <p className="mt-1 text-sm text-ink-muted">{entry.reason}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Everything considered" hint="Including what was rejected, and why." />
        {thisWeek.ranked.length === 0 ? (
          <EmptyState title="Nothing to compare yet">
            Score an opportunity and record what resources you have, and this becomes a real
            ranking rather than an empty frame.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {thisWeek.ranked.map((candidate) => (
              <li key={candidate.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-[0.65rem] text-ink-faint">#{candidate.rank}</span>{' '}
                    {candidate.subjectId ? (
                      <Link
                        href={`/opportunities/${candidate.subjectId}`}
                        className="text-sm font-medium text-ink hover:text-accent"
                      >
                        {candidate.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-ink">{candidate.title}</span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-ink-muted">
                    {candidate.expectedReturn.toFixed(1)}/day
                  </span>
                </div>
                <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-wider text-accent">
                  {candidate.kind.replace(/_/g, ' ')}
                </p>
                <p className="mt-1 text-sm text-ink-muted">{candidate.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="If the constraints were different"
          hint="Where the answer changes is more informative than any single answer."
        />
        <ul className="divide-y divide-line">
          {scenarios.map((scenario) => (
            <li key={scenario.label} className="px-4 py-3">
              <p className="font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint">
                {scenario.label}
              </p>
              <p className="mt-1 text-sm text-ink">
                {scenario.result.recommendation
                  ? scenario.result.recommendation.title
                  : 'Nothing worth starting.'}
              </p>
              {!scenario.result.recommendation && scenario.result.noActionReason ? (
                <p className="mt-1 text-sm text-ink-muted">{scenario.result.noActionReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
