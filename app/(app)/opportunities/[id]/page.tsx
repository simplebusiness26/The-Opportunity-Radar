import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OPPORTUNITY_TYPES } from '../../../../src/domain/taxonomy/opportunity-types';
import { describeConfidenceBand } from '../../../../src/domain/scoring/confidence';
import { allowedTransitions } from '../../../../src/domain/state/opportunity-state';
import type { DimensionOutcome } from '../../../../src/domain/scoring/engine';
import { explainOpportunity } from '../../../../src/application/opportunities/plain-language';
import { Callout, DemoBadge, Panel, PanelHeader } from '../../../../src/web/ui/primitives';
import { DimensionBar, EvidenceCounts, ScorePair, StateChip } from '../../../../src/web/ui/score';
import { OpportunityActions } from '../../../../src/web/components/opportunity-actions';
import { InvestigationLogPanels } from '../../../../src/web/components/investigation-log';
import { readInvestigationLog } from '../../../../src/application/opportunities/investigation-log';
import { readModeStatus } from '../../../../src/application/system/mode';
import { MemoryPanels } from '../../../../src/web/components/memory-panels';
import {
  readRelationships,
  suggestRelationships,
} from '../../../../src/application/memory/relationships';
import { listTriggers, proposeTriggers } from '../../../../src/application/memory/triggers';
import { HandoffPanel } from '../../../../src/web/components/handoff-panel';
import { buildExecutionBrief } from '../../../../src/application/execution/brief';
import { readFactoryTarget } from '../../../../src/application/execution/handoff';
import { can } from '../../../../src/domain/types/permissions';
import { readRequestContext, requireWorkspacePage } from '../../../../src/web/http/context';
import { container } from '../../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspacePage('opportunities.read');
  const { session } = await readRequestContext();
  const { id } = await params;
  const c = container();

  const opportunity = await c.repos.opportunities.findById(ctx.workspaceId, id);
  if (!opportunity) notFound();

  const [score, transitions, attached, investigation, mode, capabilities, assets] = await Promise.all([
    c.repos.scores.current(ctx.workspaceId, id),
    c.repos.opportunities.listTransitions(id),
    c.repos.opportunities.evidenceFor(id),
    readInvestigationLog(c.repos, ctx, id),
    readModeStatus(c.repos, ctx.workspaceId),
    c.repos.graph.listCapabilities(ctx.workspaceId),
    c.repos.graph.listAssets(ctx.workspaceId),
  ]);

  const memoryDeps = { repos: c.repos, tx: c.tx, clock: c.clock };
  const [relationships, suggestions, triggers, proposals, briefResult, handoffs, factoryTarget] =
    await Promise.all([
      readRelationships(c.repos, ctx, id),
      suggestRelationships(c.repos, ctx, id),
      listTriggers(memoryDeps, ctx, id),
      proposeTriggers(memoryDeps, ctx, id),
      buildExecutionBrief(memoryDeps, ctx, id),
      c.repos.handoffs.list(ctx.workspaceId, { opportunityId: id }),
      readFactoryTarget(c.repos, ctx.workspaceId),
    ]);

  const snapshot = score?.inputsSnapshot as
    | { evidence?: { rawMentions: number; uniqueEvidence: number; independentSources: number } }
    | undefined;
  const dimensions = (score?.dimensions ?? []) as DimensionOutcome[];
  const gaps = (score?.gaps ?? []) as Array<{ key: string; label: string; reason: string }>;
  const confidenceFactors = (score?.confidenceFactors ?? []) as Array<{
    label: string;
    note: string;
    contribution: number;
  }>;

  const type = OPPORTUNITY_TYPES[opportunity.typeKey];
  const band = score ? describeConfidenceBand(score.confidence) : null;
  const plain = explainOpportunity(opportunity, score, {
    capabilityNames: capabilities.map((capability) => capability.name),
    assetNames: assets.map((asset) => asset.name),
  });
  const rawTitleDiffers = plain.headline !== opportunity.title;
  const verdict = !score
    ? 'Not decided yet — Radar needs to score and validate it first.'
    : (score.attractiveness ?? 0) >= 60 && score.confidence >= 0.5
      ? 'Worth validating now — but still test the smallest version before a full build.'
      : (score.attractiveness ?? 0) >= 60
        ? 'Interesting, but not proven enough yet. Gather stronger evidence first.'
        : 'Not strong enough to commit build time right now.';

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <div className="min-w-0">
        <Link href="/opportunities" className="font-mono text-xs text-ink-faint hover:text-ink">
          ← Opportunities
        </Link>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-faint">#{opportunity.reference}</span>
          <StateChip state={opportunity.state} />
          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
            {type?.label ?? opportunity.typeKey}
          </span>
          {opportunity.demo ? <DemoBadge /> : null}
        </div>
        <h1 className="mt-2 break-words text-xl font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
          {plain.headline}
        </h1>
        {rawTitleDiffers ? (
          <p className="mt-1 break-words text-xs text-ink-faint [overflow-wrap:anywhere]">
            Original signal: {opportunity.title}
          </p>
        ) : null}
      </div>

      <Panel className="min-w-0 overflow-hidden border-accent/30">
        <PanelHeader title="Decision brief" hint="This should tell you what the opportunity is in under a minute." />
        <div className="space-y-4 px-4 py-4">
          <QuickSection label="Who has the problem" value={plain.customer} />
          <QuickSection label="The problem" value={plain.problem} />
          <QuickSection label="The commercial opportunity" value={plain.opportunity} />
          <QuickSection label="Why us" value={plain.whyUs} />
          <QuickSection label="What we can do now" value={plain.nextStep} accent />
          <QuickSection label="Why Radar believes this is real" value={plain.whyItAppeared} />
          <QuickSection label="What we still need to prove" value={plain.whatStillNeedsProof} />
          <div className="grid min-w-0 gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <div className="min-w-0 rounded-md border border-line p-3">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">Worth doing?</p>
              <p className="mt-1 break-words text-sm font-medium leading-relaxed text-ink [overflow-wrap:anywhere]">
                {verdict}
              </p>
            </div>
            <div className="min-w-0 rounded-md border border-line p-3">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">Cost / time</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                Not established yet. Radar will only show a figure when the requirement is evidenced rather than guessing.
              </p>
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="min-w-0 overflow-hidden p-4">
        {score ? (
          <>
            <ScorePair
              attractiveness={score.attractiveness}
              confidence={score.confidence}
              size="large"
            />
            {snapshot?.evidence ? (
              <div className="mt-3">
                <EvidenceCounts
                  mentions={snapshot.evidence.rawMentions}
                  unique={snapshot.evidence.uniqueEvidence}
                  independent={snapshot.evidence.independentSources}
                />
              </div>
            ) : null}
            {band ? <p className="mt-3 text-sm text-ink-muted">{band.meaning}</p> : null}
          </>
        ) : (
          <div>
            <p className="text-sm font-medium text-caution">Not scored yet</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Radar has detected this pattern, but it has not yet established whether it is attractive enough or evidenced enough to act on.
            </p>
          </div>
        )}
      </Panel>

      <OpportunityActions
        opportunityId={opportunity.id}
        state={opportunity.state}
        allowed={[...allowedTransitions(opportunity.state)]}
        csrfToken={session?.csrfSecret ?? ''}
        canInvestigate={mode.mode !== 'manual'}
      />

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title="Deeper detail" hint="The machine record behind the simple explanation above." />
        <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-ink-muted">
          <p className="break-words [overflow-wrap:anywhere]">{opportunity.thesis}</p>
          {opportunity.targetCustomer ? (
            <p className="break-words [overflow-wrap:anywhere]">
              <span className="text-ink-faint">Customer: </span>
              {opportunity.targetCustomer}
            </p>
          ) : null}
          {opportunity.problemStatement ? (
            <p className="break-words [overflow-wrap:anywhere]">
              <span className="text-ink-faint">Problem record: </span>
              {opportunity.problemStatement}
            </p>
          ) : null}
          {opportunity.whyNow ? (
            <p className="break-words [overflow-wrap:anywhere]">
              <span className="text-ink-faint">Why now: </span>
              {opportunity.whyNow}
            </p>
          ) : null}
        </div>
      </Panel>

      {gaps.length > 0 ? (
        <Callout tone="caution" title="What still needs proving">
          <ul className="mt-1 space-y-1">
            {gaps.map((gap) => (
              <li key={gap.key} className="break-words [overflow-wrap:anywhere]">
                <span className="text-ink">{gap.label}:</span> {gap.reason}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {dimensions.length > 0 ? (
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader
            title="Score breakdown"
            hint="How Radar calculated the score. A dashed bar means the answer is not established yet."
          />
          <ul className="divide-y divide-line">
            {dimensions.map((dimension) => (
              <li key={dimension.key} className="min-w-0 px-4 py-3">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <p className="min-w-0 break-words text-sm text-ink [overflow-wrap:anywhere]">{dimension.label}</p>
                  <p className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                    {dimension.status === 'ok' && dimension.normalised !== null
                      ? Math.round(dimension.normalised * 100)
                      : '—'}
                  </p>
                </div>
                <div className="mt-2">
                  <DimensionBar value={dimension.normalised} status={dimension.status} />
                </div>
                <p className="mt-1.5 break-words text-xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
                  {dimension.explanation}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {confidenceFactors.length > 0 ? (
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Why this confidence" />
          <ul className="divide-y divide-line">
            {confidenceFactors.map((factor) => (
              <li key={factor.label} className="flex min-w-0 items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="break-words text-sm text-ink [overflow-wrap:anywhere]">{factor.label}</p>
                  <p className="break-words text-xs text-ink-muted [overflow-wrap:anywhere]">{factor.note}</p>
                </div>
                <span
                  className={`shrink-0 font-mono text-xs tabular-nums ${
                    factor.contribution >= 0 ? 'text-positive' : 'text-negative'
                  }`}
                >
                  {factor.contribution >= 0 ? '+' : ''}
                  {Math.round(factor.contribution * 100)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title="Evidence" hint={`${attached.length} attached`} />
        {attached.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            No evidence is attached, so nothing here is grounded yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {attached.map((item) => (
              <li key={`${item.evidenceUnitId}-${item.stance}`} className="min-w-0 px-4 py-2.5">
                <span
                  className={`font-mono text-[0.6rem] uppercase tracking-wider ${
                    item.stance === 'for' ? 'text-positive' : 'text-negative'
                  }`}
                >
                  {item.stance === 'for' ? 'supports' : 'argues against'}
                </span>
                {item.note ? (
                  <p className="mt-1 break-words text-sm text-ink-muted [overflow-wrap:anywhere]">{item.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <InvestigationLogPanels log={investigation} aiConfigured={mode.mode !== 'manual'} />

      <HandoffPanel
        opportunityId={opportunity.id}
        brief={briefResult.brief}
        handoffs={handoffs}
        target={factoryTarget}
        canDecide={can(ctx, 'opportunities.decide')}
        csrfToken={session?.csrfSecret ?? ''}
      />

      <MemoryPanels
        opportunityId={opportunity.id}
        relationships={relationships}
        suggestions={suggestions}
        triggers={triggers}
        proposals={proposals}
        state={opportunity.state}
        csrfToken={session?.csrfSecret ?? ''}
      />

      <Panel className="min-w-0 overflow-hidden">
        <PanelHeader title="History" />
        <ul className="divide-y divide-line">
          {transitions.map((transition, index) => (
            <li key={index} className="min-w-0 px-4 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-mono text-[0.65rem] text-ink-faint">
                  {transition.createdAt.toISOString().slice(0, 10)}
                </span>
                {transition.fromState ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    {transition.fromState} →
                  </span>
                ) : null}
                <StateChip state={transition.toState} />
                <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                  by {transition.actorKind}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-ink-muted [overflow-wrap:anywhere]">{transition.reason}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function QuickSection({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p
        className={`mt-1 break-words text-sm leading-relaxed [overflow-wrap:anywhere] ${
          accent ? 'font-medium text-ink' : 'text-ink-muted'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
