import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OPPORTUNITY_TYPES } from '../../../../src/domain/taxonomy/opportunity-types';
import { describeConfidenceBand } from '../../../../src/domain/scoring/confidence';
import { allowedTransitions } from '../../../../src/domain/state/opportunity-state';
import type { DimensionOutcome } from '../../../../src/domain/scoring/engine';
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

  const [score, transitions, attached, investigation, mode] = await Promise.all([
    c.repos.scores.current(ctx.workspaceId, id),
    c.repos.opportunities.listTransitions(id),
    c.repos.opportunities.evidenceFor(id),
    readInvestigationLog(c.repos, ctx, id),
    readModeStatus(c.repos, ctx.workspaceId),
  ]);

  const memoryDeps = { repos: c.repos, tx: c.tx, clock: c.clock };
  const [relationships, suggestions, triggers, proposals] = await Promise.all([
    readRelationships(c.repos, ctx, id),
    suggestRelationships(c.repos, ctx, id),
    listTriggers(memoryDeps, ctx, id),
    proposeTriggers(memoryDeps, ctx, id),
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

  return (
    <div className="space-y-4">
      <div>
        <Link href="/opportunities" className="font-mono text-xs text-ink-faint hover:text-ink">
          ← Opportunities
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-faint">#{opportunity.reference}</span>
          <StateChip state={opportunity.state} />
          <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
            {type?.label ?? opportunity.typeKey}
          </span>
          {opportunity.demo ? <DemoBadge /> : null}
        </div>
        <h1 className="mt-2 text-xl font-semibold text-ink">{opportunity.title}</h1>
      </div>

      <Panel className="p-4">
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
          <p className="text-sm text-ink-muted">
            Not scored yet. Attach evidence and run scoring to see where this stands.
          </p>
        )}
      </Panel>

      <OpportunityActions
        opportunityId={opportunity.id}
        state={opportunity.state}
        allowed={[...allowedTransitions(opportunity.state)]}
        csrfToken={session?.csrfSecret ?? ''}
        canInvestigate={mode.mode !== 'manual'}
      />

      <Panel>
        <PanelHeader title="Thesis" />
        <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-ink-muted">
          <p>{opportunity.thesis}</p>
          {opportunity.targetCustomer ? (
            <p>
              <span className="text-ink-faint">Customer: </span>
              {opportunity.targetCustomer}
            </p>
          ) : null}
          {opportunity.problemStatement ? (
            <p>
              <span className="text-ink-faint">Problem: </span>
              {opportunity.problemStatement}
            </p>
          ) : null}
          {opportunity.whyNow ? (
            <p>
              <span className="text-ink-faint">Why now: </span>
              {opportunity.whyNow}
            </p>
          ) : null}
        </div>
      </Panel>

      {gaps.length > 0 ? (
        <Callout tone="caution" title="What has not been established">
          <ul className="mt-1 space-y-1">
            {gaps.map((gap) => (
              <li key={gap.key}>
                <span className="text-ink">{gap.label}:</span> {gap.reason}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {dimensions.length > 0 ? (
        <Panel>
          <PanelHeader
            title="Score breakdown"
            hint="Every number here is arithmetic over recorded evidence. Dashed bars are things nothing has established."
          />
          <ul className="divide-y divide-line">
            {dimensions.map((dimension) => (
              <li key={dimension.key} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink">{dimension.label}</p>
                  <p className="font-mono text-xs tabular-nums text-ink-muted">
                    {dimension.status === 'ok' && dimension.normalised !== null
                      ? Math.round(dimension.normalised * 100)
                      : '—'}
                  </p>
                </div>
                <div className="mt-2">
                  <DimensionBar value={dimension.normalised} status={dimension.status} />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{dimension.explanation}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {confidenceFactors.length > 0 ? (
        <Panel>
          <PanelHeader title="Why this confidence" />
          <ul className="divide-y divide-line">
            {confidenceFactors.map((factor) => (
              <li key={factor.label} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-sm text-ink">{factor.label}</p>
                  <p className="text-xs text-ink-muted">{factor.note}</p>
                </div>
                <span
                  className={`font-mono text-xs tabular-nums ${
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

      <Panel>
        <PanelHeader title="Evidence" hint={`${attached.length} attached`} />
        {attached.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            No evidence is attached, so nothing here is grounded yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {attached.map((item) => (
              <li key={`${item.evidenceUnitId}-${item.stance}`} className="px-4 py-2.5">
                <span
                  className={`font-mono text-[0.6rem] uppercase tracking-wider ${
                    item.stance === 'for' ? 'text-positive' : 'text-negative'
                  }`}
                >
                  {item.stance === 'for' ? 'supports' : 'argues against'}
                </span>
                {item.note ? <p className="mt-1 text-sm text-ink-muted">{item.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <InvestigationLogPanels log={investigation} aiConfigured={mode.mode !== 'manual'} />

      <MemoryPanels
        opportunityId={opportunity.id}
        relationships={relationships}
        suggestions={suggestions}
        triggers={triggers}
        proposals={proposals}
        state={opportunity.state}
        csrfToken={session?.csrfSecret ?? ''}
      />

      <Panel>
        <PanelHeader title="History" />
        <ul className="divide-y divide-line">
          {transitions.map((transition, index) => (
            <li key={index} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
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
              <p className="mt-1 text-sm text-ink-muted">{transition.reason}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
