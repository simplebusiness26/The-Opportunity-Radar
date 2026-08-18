import Link from 'next/link';
import { buildDashboard } from '../../../src/application/system/dashboard';
import { MODE_DESCRIPTIONS } from '../../../src/domain/config/mode';
import { readModeStatus } from '../../../src/application/system/mode';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { DeltaBadge, ScorePair, StateChip } from '../../../src/web/ui/score';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { ctx } = await requireWorkspacePage('workspace.read');
  const c = container();

  const since = new Date(c.clock.epochMs() - 7 * 86_400_000);
  const [view, mode] = await Promise.all([
    buildDashboard(c.repos, ctx.workspaceId, since),
    readModeStatus(c.repos, ctx.workspaceId),
  ]);

  const best = view.bestMove;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Radar</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What deserves attention, why, and what changed.
        </p>
      </div>

      <Panel className="p-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-faint">
          Best move right now
        </p>
        <h2
          className={`mt-2 text-lg font-semibold ${
            best.kind === 'no_action' ? 'text-caution' : 'text-ink'
          }`}
        >
          {best.headline}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{best.reasoning}</p>

        {best.opportunity && best.score ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Top opportunities" hint="Ranked by score. Confidence shown alongside, never blended in." />
          {view.top.length === 0 ? (
            <EmptyState title="Nothing ranked yet">
              Create an opportunity and attach evidence to it, and it will appear here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {view.top.map(({ opportunity, score }) => (
                <li key={opportunity.id}>
                  <Link
                    href={`/opportunities/${opportunity.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-raised"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-ink-faint">#{opportunity.reference}</span>
                        <StateChip state={opportunity.state} />
                      </div>
                      <p className="mt-1 truncate text-sm text-ink">{opportunity.title}</p>
                    </div>
                    {score ? (
                      <ScorePair attractiveness={score.attractiveness} confidence={score.confidence} />
                    ) : (
                      <span className="font-mono text-xs text-ink-faint">unscored</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="What changed" hint="Movements over the last seven days." />
          {view.changes.length === 0 ? (
            <EmptyState title="Nothing has moved">
              Radar reports movement only when a score genuinely changes, so silence here means
              nothing new has been learned rather than that nothing was checked.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {view.changes.map((change, index) => (
                <li key={index} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{change.opportunityTitle}</p>
                    <p className="font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint">
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

      <Panel>
        <PanelHeader title="Machine status" />
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {[
            { label: 'Signals', value: view.counts.signals },
            { label: 'Opportunities', value: view.counts.opportunities },
            { label: 'Active', value: view.counts.active },
            { label: 'Mode', value: mode.mode.replace('_', ' ') },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface px-4 py-3">
              <p className="font-mono text-lg tabular-nums text-ink">{stat.value}</p>
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

          {/*
            The bottom bar on a phone holds five destinations; these are the
            rest, so nothing is reachable only on a wide screen.
          */}
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
