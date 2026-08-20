import Link from 'next/link';
import { OPPORTUNITY_TYPES } from '../../../src/domain/taxonomy/opportunity-types';
import { Button, DemoBadge, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { StateChip } from '../../../src/web/ui/score';
import { isOwnerFacingOpportunity } from '../../../src/application/opportunities/commercial-visibility';
import { explainOpportunity } from '../../../src/application/opportunities/plain-language';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  const { ctx } = await requireWorkspacePage('opportunities.read');
  const c = container();

  const [allRows, capabilities, assets] = await Promise.all([
    c.repos.opportunities.list(ctx.workspaceId, { includeDemo: true }),
    c.repos.graph.listCapabilities(ctx.workspaceId),
    c.repos.graph.listAssets(ctx.workspaceId),
  ]);
  const rows = allRows.filter(isOwnerFacingOpportunity);
  const scores = await c.repos.scores.currentForMany(ctx.workspaceId, rows.map((row) => row.id));
  const explanationContext = {
    capabilityNames: capabilities.map((capability) => capability.name),
    assetNames: assets.map((asset) => asset.name),
  };

  const ranked = [...rows].sort((a, b) => {
    const left = scores.get(a.id)?.attractiveness ?? -1;
    const right = scores.get(b.id)?.attractiveness ?? -1;
    return right - left;
  });

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Opportunities</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            This screen is for decisions, not trends. Every automatic opportunity must name a buyer, a real problem, a commercial opening and a practical move we can make.
          </p>
        </div>
        <Link href="/opportunities/new">
          <Button>New opportunity</Button>
        </Link>
      </div>

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader
          title={`${rows.length} qualified ${rows.length === 1 ? 'opportunity' : 'opportunities'}`}
          hint="If Radar cannot explain who pays, what hurts and what we can do, it does not belong here."
        />
        {ranked.length === 0 ? (
          <EmptyState
            title="No qualified opportunities yet"
            action={
              <Link href="/opportunities/new">
                <Button variant="secondary">Create one manually</Button>
              </Link>
            }
          >
            That is better than showing noise. Radar may still have useful signals and repeated problems; they only move here after a buyer and commercial mechanism are established.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {ranked.map((opportunity) => {
              const score = scores.get(opportunity.id);
              const type = OPPORTUNITY_TYPES[opportunity.typeKey];
              const plain = explainOpportunity(opportunity, score, explanationContext);
              return (
                <li key={opportunity.id} className="min-w-0">
                  <Link
                    href={`/opportunities/${opportunity.id}`}
                    className="block min-w-0 px-4 py-4 hover:bg-surface-raised"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-faint">#{opportunity.reference}</span>
                      <StateChip state={opportunity.state} />
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                        {type?.label ?? opportunity.typeKey}
                      </span>
                      {opportunity.demo ? <DemoBadge /> : null}
                    </div>

                    <h2 className="mt-2 break-words text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
                      {plain.headline}
                    </h2>

                    <div className="mt-3 space-y-2.5">
                      <QuickLine label="Who has the problem" value={plain.customer} />
                      <QuickLine label="The problem" value={plain.problem} />
                      <QuickLine label="The opportunity" value={plain.opportunity} />
                      <QuickLine label="Why us" value={plain.whyUs} />
                      <QuickLine label="What we can do now" value={plain.nextStep} accent />
                      <QuickLine label="What still needs proving" value={plain.whatStillNeedsProof} />
                    </div>

                    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                      <p className="min-w-0 break-words text-xs leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
                        {plain.whyItAppeared}
                      </p>
                      <div className="shrink-0 text-right">
                        {score ? (
                          <p className="font-mono text-xs text-ink-muted">
                            score {score.attractiveness ?? '—'} · {Math.round(score.confidence * 100)}% confidence
                          </p>
                        ) : (
                          <p className="font-mono text-xs text-caution">awaiting score</p>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 font-mono text-xs text-accent">Open decision brief →</p>
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
