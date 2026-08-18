import Link from 'next/link';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { listClustersWithReadiness } from '../../../src/application/clusters/cluster-evidence';
import { Callout, DemoBadge, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { EvidenceCounts } from '../../../src/web/ui/score';
import { AssignEvidenceButton } from '../../../src/web/components/assign-evidence-button';

export const dynamic = 'force-dynamic';

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function ClustersPage() {
  const { ctx, session } = await requireWorkspacePage('signals.read');
  const c = container();

  const [clusters, unclustered] = await Promise.all([
    listClustersWithReadiness({ repos: c.repos, tx: c.tx, clock: c.clock }, ctx, { limit: 100 }),
    c.repos.evidence.listClusterable(ctx.workspaceId, { unclusteredOnly: true, limit: 50 }),
  ]);

  const ready = clusters.filter((entry) => entry.readiness.ready).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Problems</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Evidence grouped by the underlying problem it points at. A problem earns
            investigation when several <em>independent</em> parties have hit it — not when one
            person has said it loudly.
          </p>
        </div>
        <AssignEvidenceButton pending={unclustered.length} csrfToken={session?.csrfSecret ?? ''} />
      </div>

      {clusters.length > 0 ? (
        <p className="font-mono text-xs text-ink-faint">
          {clusters.length} {clusters.length === 1 ? 'problem' : 'problems'} · {ready} ready to
          investigate
        </p>
      ) : null}

      <Panel>
        <PanelHeader title="Problems" />
        {clusters.length === 0 ? (
          <EmptyState title="No problems identified yet">
            Radar groups evidence into problems once it has some to group. Record a few
            observations first, then let it sort them.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {clusters.map(({ cluster, readiness }) => (
              <li key={cluster.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-accent">
                    {cluster.status}
                  </span>
                  {cluster.demo ? <DemoBadge /> : null}
                  {readiness.ready ? (
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider text-positive">
                      ready to investigate
                    </span>
                  ) : null}
                </div>

                <Link href={`/clusters/${cluster.id}`} className="mt-1 block">
                  <p className="text-sm font-medium text-ink hover:text-accent">{cluster.title}</p>
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                  {cluster.problemStatement}
                </p>

                <div className="mt-2">
                  <EvidenceCounts
                    mentions={cluster.rawMentions}
                    unique={cluster.uniqueEvidenceCount}
                    independent={cluster.independentSourceCount}
                  />
                </div>

                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  confidence {percent(cluster.confidence)}
                  <span className="mx-1.5 text-line">·</span>
                  source spread {percent(cluster.sourceDiversity)}
                  {cluster.momentum30d !== null ? (
                    <>
                      <span className="mx-1.5 text-line">·</span>
                      {percent(cluster.momentum30d)} of evidence in the last 30 days
                    </>
                  ) : null}
                </p>

                {!readiness.ready ? (
                  <p className="mt-1.5 text-xs text-ink-faint">{readiness.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {unclustered.length > 0 ? (
        <Panel>
          <PanelHeader
            title={`${unclustered.length} pieces of evidence not in any problem`}
            hint="Evidence that matched no existing problem closely enough to join one."
          />
          <Callout tone="neutral">
            Radar will not invent a problem from a single observation — that would turn this page
            back into a list of signals. Group these by hand when you can see the pattern, or
            record more evidence and run the grouping again.
          </Callout>
          <ul className="divide-y divide-line">
            {unclustered.slice(0, 20).map((unit) => (
              <li key={unit.id} className="px-4 py-2.5">
                <p className="text-sm text-ink">{unit.claimText}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {unit.originKeys.length || 0}{' '}
                  {unit.originKeys.length === 1 ? 'origin' : 'origins'}
                  <span className="mx-1.5 text-line">·</span>
                  last seen {unit.lastSeenAt.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
