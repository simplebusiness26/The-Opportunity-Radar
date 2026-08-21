import Link from 'next/link';
import { OPPORTUNITY_TYPES } from '../../../src/domain/taxonomy/opportunity-types';
import { Button, DemoBadge, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { StateChip } from '../../../src/web/ui/score';
import { isOwnerFacingOpportunity } from '../../../src/application/opportunities/commercial-visibility';
import { explainOpportunity } from '../../../src/application/opportunities/plain-language';
import {
  EARLY_CANDIDATE_ENVELOPE,
  estimateOpportunityResources,
  type OpportunityResourceEnvelope,
} from '../../../src/application/opportunities/resource-envelope';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  const { ctx } = await requireWorkspacePage('opportunities.read');
  const c = container();

  const [allRows, capabilities, assets, resources, clusters] = await Promise.all([
    c.repos.opportunities.list(ctx.workspaceId, { includeDemo: true }),
    c.repos.graph.listCapabilities(ctx.workspaceId),
    c.repos.graph.listAssets(ctx.workspaceId),
    c.repos.graph.listResources(ctx.workspaceId),
    c.repos.clusters.list(ctx.workspaceId, {
      status: ['new', 'watching', 'investigating'],
      includeDemo: false,
      limit: 100,
    }),
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

  const universe = clusters
    .filter((cluster) => cluster.uniqueEvidenceCount >= 2 && cluster.independentSourceCount >= 2)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.independentSourceCount - a.independentSourceCount ||
        b.uniqueEvidenceCount - a.uniqueEvidenceCount,
    )
    .slice(0, 30);

  const currentBudget = resources.filter((resource) => resource.resourceKind === 'budget');
  const currentTime = resources.filter((resource) => resource.resourceKind === 'time');

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Opportunities</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            See both the opportunities Radar can defend now and the wider market it is watching. Your current budget and time affect what is practical now, but they no longer stop you seeing bigger opportunities.
          </p>
        </div>
        <Link href="/opportunities/new">
          <Button>New opportunity</Button>
        </Link>
      </div>

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader
          title="Your current operating envelope"
          hint="Used for fit and prioritisation. The Opportunity Universe below deliberately looks beyond it."
        />
        <div className="grid min-w-0 gap-3 p-4 sm:grid-cols-2">
          <ResourceSummary
            label="Budget available"
            values={currentBudget.map((resource) => formatAvailableResource(resource.amount, resource.committed, resource.unit, resource.period))}
          />
          <ResourceSummary
            label="Time available"
            values={currentTime.map((resource) => formatAvailableResource(resource.amount, resource.committed, resource.unit, resource.period))}
          />
        </div>
      </Panel>

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader
          title={`${rows.length} qualified ${rows.length === 1 ? 'opportunity' : 'opportunities'} now`}
          hint="These have passed Radar’s buyer + problem + commercial mechanism gate."
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
            That does not mean Radar has found nothing. Scroll to Opportunity Universe to see the broader evidence-backed market candidates, including opportunities that need more time, money or proof than you have right now.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {ranked.map((opportunity) => {
              const score = scores.get(opportunity.id);
              const type = OPPORTUNITY_TYPES[opportunity.typeKey];
              const plain = explainOpportunity(opportunity, score, explanationContext);
              const envelope = estimateOpportunityResources(opportunity.typeKey);
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

                    <ResourceEnvelope envelope={envelope} />

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

      <Panel className="min-w-0 overflow-hidden border-accent/30">
        <PanelHeader
          title={`Opportunity Universe · ${universe.length} broader ${universe.length === 1 ? 'candidate' : 'candidates'}`}
          hint="This view ignores your current budget and working hours. It shows repeated market problems first, then tells you what resources would be needed to validate or pursue them."
        />
        {universe.length === 0 ? (
          <EmptyState title="The wider radar is still gathering repeated evidence">
            A candidate appears here after the same problem is independently corroborated. It does not need to fit your current budget or hours, but Radar still requires more than a single mention before showing it.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {universe.map((cluster) => {
              const pursuit = estimateOpportunityResources('new_product');
              return (
                <li key={cluster.id} className="min-w-0 px-4 py-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="rounded-sm border border-line px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                      broader market
                    </span>
                    <span className="font-mono text-[0.62rem] text-ink-faint">
                      {Math.round(cluster.confidence * 100)}% pattern confidence
                    </span>
                  </div>

                  <h2 className="mt-2 break-words text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
                    {cluster.title}
                  </h2>

                  <div className="mt-3 space-y-2.5">
                    <QuickLine
                      label="Who appears to have the problem"
                      value={cluster.targetCustomer ?? 'Buyer not named yet — this is one reason it has not reached the qualified feed.'}
                    />
                    <QuickLine label="The repeated problem" value={cluster.problemStatement} />
                    <QuickLine
                      label="Evidence so far"
                      value={`${cluster.uniqueEvidenceCount} distinct evidence units from ${cluster.independentSourceCount} independent sources.`}
                    />
                    <QuickLine
                      label="Why it is not in the qualified feed yet"
                      value={
                        cluster.targetCustomer
                          ? 'Radar still needs the commercial mechanism proved strongly enough — spending, active demand, paid labour, a workaround, supply gap or weak incumbent.'
                          : 'Radar still needs to establish who would actually buy, then prove the commercial mechanism.'
                      }
                    />
                  </div>

                  <div className="mt-3 grid min-w-0 gap-3 rounded-md border border-line bg-surface-raised p-3 sm:grid-cols-2">
                    <ResourceBox
                      label="Validate it"
                      budget={EARLY_CANDIDATE_ENVELOPE.budgetLabel}
                      hours={`${EARLY_CANDIDATE_ENVELOPE.totalHours[0]}–${EARLY_CANDIDATE_ENVELOPE.totalHours[1]} focused hours`}
                      note="Cheap proof stage before committing to a build."
                    />
                    <ResourceBox
                      label="If pursued as a new product"
                      budget={pursuit.budgetLabel}
                      hours={`${pursuit.totalHours[0]}–${pursuit.totalHours[1]} focused hours`}
                      note={`${pursuit.effortDays[0]}–${pursuit.effortDays[1]} focused workdays. Planning prior, not a quote.`}
                    />
                  </div>
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

function ResourceEnvelope({ envelope }: { envelope: OpportunityResourceEnvelope }) {
  return (
    <div className="mt-3 grid min-w-0 gap-3 rounded-md border border-line bg-surface-raised p-3 sm:grid-cols-3">
      <ResourceMetric label="Planning budget" value={envelope.budgetLabel} />
      <ResourceMetric
        label="Focused time"
        value={`${envelope.totalHours[0]}–${envelope.totalHours[1]} hours`}
      />
      <ResourceMetric label="Commitment" value={envelope.intensityLabel} />
      <p className="break-words text-[0.68rem] leading-relaxed text-ink-faint sm:col-span-3 [overflow-wrap:anywhere]">
        {envelope.basis}
      </p>
    </div>
  );
}

function ResourceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-ink [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function ResourceBox({ label, budget, hours, note }: { label: string; budget: string; hours: string; note: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink">{budget}</p>
      <p className="mt-0.5 text-sm text-ink-muted">{hours}</p>
      <p className="mt-1 break-words text-xs leading-relaxed text-ink-faint [overflow-wrap:anywhere]">{note}</p>
    </div>
  );
}

function ResourceSummary({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="min-w-0 rounded-md border border-line p-3">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      {values.length ? (
        values.map((value) => (
          <p key={value} className="mt-1 break-words text-sm font-medium text-ink [overflow-wrap:anywhere]">
            {value}
          </p>
        ))
      ) : (
        <p className="mt-1 text-sm text-ink-muted">Not recorded yet — Universe still remains visible.</p>
      )}
    </div>
  );
}

function formatAvailableResource(amount: number, committed: number, unit: string, period: string): string {
  const available = Math.max(0, amount - committed);
  return `${available.toLocaleString()} ${unit}${period ? ` / ${period}` : ''}`;
}
