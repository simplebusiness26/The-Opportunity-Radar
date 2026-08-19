import Link from 'next/link';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { allocateResources } from '../../../src/application/intelligence/allocate-resources';
import { deriveCapitalUnlockReport } from '../../../src/domain/allocation/capital';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';

export const dynamic = 'force-dynamic';

const pounds = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export default async function PortfolioPage() {
  const { ctx } = await requireWorkspacePage('opportunities.read');
  const c = container();
  const deps = { repos: c.repos, tx: c.tx, clock: c.clock };

  const [thisWeek, capitalHorizon] = await Promise.all([
    allocateResources(deps, ctx, { horizonDays: 7 }),
    allocateResources(deps, ctx, { horizonDays: 30 }),
  ]);
  const capital = deriveCapitalUnlockReport(capitalHorizon);

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
          title="What more money could unlock"
          hint="Only evidence-backed cash requirements appear here."
        />
        {capital.currentBudget === null ? (
          <div className="px-4 pt-3">
            <Callout tone="caution" title="Current budget is not recorded yet">
              Radar can still show known funding thresholds, but it cannot calculate the exact
              extra amount you would need from your current position until your real budget is saved.
            </Callout>
          </div>
        ) : null}

        {capital.unlocks.length === 0 ? (
          <EmptyState title="No evidenced paid unlocks yet">
            Radar has not found a candidate with a verified cash requirement above your current
            budget. It will not invent a bigger-budget opportunity just to fill this section.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {capital.unlocks.map((unlock) => (
              <li key={unlock.candidateId} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[0.65rem] uppercase tracking-wider text-accent">
                      Unlocks at {pounds.format(unlock.requiredBudget)}
                      {unlock.additionalBudgetNeeded !== null
                        ? ` · +${pounds.format(unlock.additionalBudgetNeeded)} needed`
                        : ''}
                    </p>
                    {unlock.subjectId ? (
                      <Link
                        href={`/opportunities/${unlock.subjectId}`}
                        className="mt-1 block text-sm font-medium text-ink hover:text-accent"
                      >
                        {unlock.title}
                      </Link>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-ink">{unlock.title}</p>
                    )}
                  </div>
                  <span className="font-mono text-xs text-ink-muted">
                    {unlock.timeNeededDays}d · {Math.round(unlock.confidence * 100)}% conf.
                  </span>
                </div>

                {unlock.requirements.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                    {unlock.requirements.map((requirement, index) => (
                      <li key={`${unlock.candidateId}:${index}`}>
                        {pounds.format(requirement.amount)} — {requirement.label}
                        {requirement.note ? `: ${requirement.note}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-ink-muted">
                    The total cash requirement is recorded, but its spending breakdown is not yet.
                  </p>
                )}

                {unlock.blockers.length > 0 ? (
                  <div className="mt-2 rounded-md border border-line px-3 py-2">
                    <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                      Money alone would not be enough
                    </p>
                    <ul className="mt-1 space-y-1 text-sm text-ink-muted">
                      {unlock.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {capital.unknownCapital.length > 0 ? (
        <Panel>
          <PanelHeader
            title="Cash requirement still unknown"
            hint="High-potential options that need capital research before budget comparison."
          />
          <ul className="divide-y divide-line">
            {capital.unknownCapital.slice(0, 8).map((candidate) => (
              <li key={candidate.candidateId} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {candidate.subjectId ? (
                    <Link
                      href={`/opportunities/${candidate.subjectId}`}
                      className="text-sm font-medium text-ink hover:text-accent"
                    >
                      {candidate.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-ink">{candidate.title}</p>
                  )}
                  <span className="font-mono text-xs text-ink-muted">
                    {candidate.timeNeededDays}d · {Math.round(candidate.confidence * 100)}% conf.
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {candidate.reason} Radar must establish what would need paying for before it can
                  say whether £100, £1,000 or £10,000 changes this opportunity.
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
