import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireWorkspacePage } from '../../../../src/web/http/context';
import { container } from '../../../../src/composition/container';
import { assessClusterReadiness, DEFAULT_CLUSTERING } from '../../../../src/domain/clustering/index';
import { EVIDENCE_CLASSES } from '../../../../src/domain/taxonomy/evidence-class';
import { Callout, DemoBadge, Panel, PanelHeader } from '../../../../src/web/ui/primitives';
import { EvidenceCounts } from '../../../../src/web/ui/score';

export const dynamic = 'force-dynamic';

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspacePage('signals.read');
  const { id } = await params;
  const c = container();

  const cluster = await c.repos.clusters.findById(ctx.workspaceId, id);
  if (!cluster) notFound();

  const memberIds = await c.repos.clusters.memberEvidenceIds(cluster.id);
  const evidence = memberIds.length
    ? await c.repos.evidence.listByIds(ctx.workspaceId, memberIds)
    : [];

  const readiness = assessClusterReadiness(
    {
      rawMentions: cluster.rawMentions,
      uniqueEvidenceCount: cluster.uniqueEvidenceCount,
      independentEvidenceCount: cluster.uniqueEvidenceCount,
      independentSourceCount: cluster.independentSourceCount,
      sourceDiversity: cluster.sourceDiversity,
      momentum30d: cluster.momentum30d,
      firstSeenAt: cluster.firstSeenAt,
      lastEvidenceAt: cluster.lastEvidenceAt,
      totalStrength: 0,
    },
    DEFAULT_CLUSTERING,
  );

  return (
    <div className="space-y-4">
      <div>
        <Link href="/clusters" className="font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint hover:text-ink">
          ← Problems
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-accent">
            {cluster.status}
          </span>
          {cluster.demo ? <DemoBadge /> : null}
        </div>
        <h1 className="mt-1 text-xl font-semibold text-ink">{cluster.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{cluster.problemStatement}</p>
        {cluster.targetCustomer ? (
          <p className="mt-1.5 text-sm text-ink-muted">
            <span className="text-ink-faint">Who has it: </span>
            {cluster.targetCustomer}
          </p>
        ) : null}
      </div>

      <Panel>
        <PanelHeader title="How well supported this is" />
        <div className="space-y-3 px-4 py-3">
          <EvidenceCounts
            mentions={cluster.rawMentions}
            unique={cluster.uniqueEvidenceCount}
            independent={cluster.independentSourceCount}
          />
          <p className="font-mono text-xs text-ink-faint">
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

          {readiness.ready ? (
            <Callout tone="positive" title="Ready to investigate">
              Enough independent parties have hit this to justify spending research effort on it.
            </Callout>
          ) : (
            <Callout tone="caution" title="Not yet worth investigating">
              {readiness.reason} Confidence is deliberately capped while the evidence all traces
              back to the same few origins — repetition is not corroboration.
            </Callout>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={`Evidence (${evidence.length})`} />
        {evidence.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">No evidence attached.</p>
        ) : (
          <ul className="divide-y divide-line">
            {evidence.map((unit) => (
              <li key={unit.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    {EVIDENCE_CLASSES[unit.evidenceClass]?.label ?? unit.evidenceClass}
                  </span>
                  {unit.demo ? <DemoBadge /> : null}
                </div>
                <p className="mt-1 text-sm text-ink">{unit.canonicalClaim}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {unit.mentionCount} {unit.mentionCount === 1 ? 'mention' : 'mentions'}
                  <span className="mx-1.5 text-line">·</span>
                  {unit.independentSourceCount} independent
                  <span className="mx-1.5 text-line">·</span>
                  strength {unit.effectiveStrength.toFixed(2)}
                  <span className="mx-1.5 text-line">·</span>
                  last seen {unit.lastSeenAt.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
