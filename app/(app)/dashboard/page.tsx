import Link from 'next/link';
import { buildDashboard } from '../../../src/application/system/dashboard';
import { MODE_DESCRIPTIONS } from '../../../src/domain/config/mode';
import { readModeStatus } from '../../../src/application/system/mode';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { readOnboarding } from '../../../src/application/system/onboarding';
import { DeltaBadge, ScorePair, StateChip } from '../../../src/web/ui/score';
import { explainOpportunity } from '../../../src/application/opportunities/plain-language';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { ctx } = await requireWorkspacePage('workspace.read');
  const c = container();

  const since = new Date(c.clock.epochMs() - 7 * 86_400_000);
  const [view, mode, onboarding] = await Promise.all([
    buildDashboard(c.repos, ctx.workspaceId, since),
    readModeStatus(c.repos, ctx.workspaceId),
    readOnboarding(c.repos, ctx.workspaceId),
  ]);

  const best = view.bestMove;

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <div>
        <h1 className="text-xl font-semibold text-ink">Radar</h1>
        <p className="mt-1 text-sm text-ink-muted">
          A quick view of the problems Radar is seeing, the possible opportunity, and what to do next.
        </p>
      </div>

      {!onboarding.ready && onboarding.next ? (
        <Callout tone="caution" title={`Radar is judging with half the picture: ${onboarding.next.title.toLowerCase()}`}>
          {onboarding.next.why}{' '}
          <a href="/onboarding" className="underline">
            Finish setting up
          </a>
          .
        </Callout>
      ) : null}

      <Panel className="min-w-0 overflow-hidden p-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-faint">
          Best move right now
        </p>
        <h2
          className={`mt-2 break-words text-lg font-semibold [overflow-wrap:anywhere] ${
            best.kind === 'no_action' ? 'text-caution' : 'text-ink'
          }`}
        >
          {best.headline}
        </h2>
        <p className="mt-2 break-words text-sm leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
          {best.reasoning}
        </p>

        {best.opportunity && best.score ? (
          <div className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ScorePair
              attractiveness={best.score.attractiveness}
              confidence={best.score.confidence}
            />
            <Link
              href={`/opportunities/${best.opportunity.id}`}
              className="font-mono text-xs text-accent hover:underline"
            >
              Open #{best.opportunity.reference} →
            </Link>
          </div>
        ) : null}

        {best.doNotYet.length > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-faint">
              Do not do yet
            </p>
            <ul className="mt-1.5 space-y-1 text-sm text-ink-muted">
              {best.doNotYet.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader
            title="Opportunities Radar found"
            hint="Read each one as: problem → opportunity → what we do next."
          />
          {view.top.length === 0 ? (
            <EmptyState title="Nothing ranked yet">
              Radar is still collecting and grouping evidence. Qualified opportunities will appear here automatically.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {view.top.map(({ opportunity, score }) => {
                const plain = explainOpportunity(opportunity, score);
                return (
                  <li key={opportunity.id} className="min-w-0">
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="block min-w-0 px-4 py-4 hover:bg-surface-raised"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-ink-faint">#{opportunity.reference}</span>
                        <StateChip state={opportunity.state} />
                        {score ? (
                          <span className="font-mono text-[0.65rem] text-ink-muted">
                            score {score.attractiveness ?? '—'} · {Math.round(score.confidence * 100)}% confidence
                          </span>
                        ) : (
                          <span className="font-mono text-[0.65rem] text-caution">not scored yet</span>
                        )}
                      </div>

                      <h3 className="mt-2 break-words text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
                        {plain.headline}
                      </h3>

                      <div className="mt-3 space-y-2.5">
                        <QuickLine label="Problem" value={plain.problem} />
                        <QuickLine label="Opportunity" value={plain.opportunity} />
                        <QuickLine label="What we do" value={plain.nextStep} accent />
                      </div>

                      <p className="mt-3 break-words text-xs leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
                        {plain.whyItAppeared}
                      </p>
                      <p className="mt-2 font-mono text-xs text-accent">Open simple breakdown →</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="What changed" hint="Movements over the last seven days." />
          {view.changes.length === 0 ? (
            <EmptyState title="Nothing has moved">
              Radar reports movement only when a score genuinely changes, so silence here means
              nothing new has been learned rather than that nothing was checked.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {view.changes.map((change, index) => (
                <li key={index} className="flex min-w-0 items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="break-words text-sm text-ink [overflow-wrap:anywhere]">{change.opportunityTitle}</p>
                    <p className="break-words font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint [overflow-wrap:anywhere]">
                      {change.composite.replace(/_/g, ' ')} · {change.cause.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <DeltaBadge delta={change.delta} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title="Machine status" />
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {[
            { label: 'Signals', value: view.counts.signals },
            { label: 'Opportunities', value: view.counts.opportunities },
            { label: 'Active', value: view.counts.active },
            { label: 'Mode', value: mode.mode.replace('_', ' ') },
          ].map((stat) => (
            <div key={stat.label} className="min-w-0 bg-surface px-4 py-3">
              <p className="break-words font-mono text-lg tabular-nums text-ink [overflow-wrap:anywhere]">{stat.value}</p>
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-ink-muted">{MODE_DESCRIPTIONS[mode.mode]}</p>
          {mode.missingForNext.length > 0 ? (
            <div className="mt-3">
              <Callout tone="neutral" title={`To reach ${mode.nextMode?.replace('_', ' ')} mode`}>
                <ul className="space-y-1">
                  {mode.missingForNext.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </Callout>
            </div>
          ) : null}

          <nav aria-label="More" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 md:hidden">
            {(
              [
                { href: '/brief', label: 'Daily brief' },
                { href: '/intelligence', label: 'Our capability' },
                { href: '/sources', label: 'Sources' },
                { href: '/system', label: 'Machine' },
                { href: '/settings', label: 'Settings' },
              ] as const
            ).map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-accent hover:underline">
                {item.label} →
              </Link>
            ))}
          </nav>
        </div>
      </Panel>
    </div>
  );
}

function QuickLine({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p
        className={`mt-0.5 break-words text-sm leading-relaxed [overflow-wrap:anywhere] ${
          accent ? 'font-medium text-ink' : 'text-ink-muted'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
