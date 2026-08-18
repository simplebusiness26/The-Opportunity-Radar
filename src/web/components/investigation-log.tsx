import { INVESTIGATION_ROLES } from '../../pipeline/investigations/roles';
import type { InvestigationLog } from '../../application/opportunities/investigation-log';
import { Callout, Panel, PanelHeader } from '../ui/primitives';

/**
 * What the investigation found, and what it cost.
 *
 * Each entry names the run that produced it and anything the projector had to
 * correct, because a conclusion shown without its provenance is just an
 * assertion in a nicer font.
 */
export function InvestigationLogPanels({
  log,
  aiConfigured,
}: {
  log: InvestigationLog;
  aiConfigured: boolean;
}) {
  const finished = log.entries.filter((entry) => entry.run.state === 'complete');
  const refused = log.entries.filter(
    (entry) => entry.run.state === 'terminated' || entry.run.state === 'blocked',
  );

  return (
    <>
      <Panel>
        <PanelHeader
          title="Investigation"
          hint={
            finished.length > 0
              ? `${finished.length} stage(s) complete · $${log.totalSpentUsd.toFixed(4)} spent`
              : 'Nothing has been investigated yet'
          }
        />

        {log.entries.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            {aiConfigured
              ? 'No investigation has run. Radar only spends on research once an opportunity has enough independent evidence to make it worth paying for.'
              : 'No AI provider is connected, so nothing can be investigated. Everything else on this page works without one.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {log.entries.map((entry) => {
              const role = INVESTIGATION_ROLES[entry.run.roleKey as keyof typeof INVESTIGATION_ROLES];
              return (
                <li key={entry.run.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-ink">{role?.name ?? entry.run.roleKey}</p>
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                      {entry.run.state}
                      {entry.run.spentUsd > 0 ? ` · $${entry.run.spentUsd.toFixed(4)}` : ''}
                    </span>
                  </div>
                  {entry.run.terminationReason ? (
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {entry.run.terminationReason}
                    </p>
                  ) : null}
                  {entry.payload ? <FindingSummary schemaKey={entry.schemaKey} payload={entry.payload} /> : null}
                  {entry.correction && entry.correction !== 'Nothing needed correcting.' ? (
                    <p className="mt-1.5 font-mono text-[0.65rem] text-caution">{entry.correction}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {refused.length > 0 ? (
        <Callout tone="caution" title="Why research stopped">
          <ul className="mt-1 space-y-1">
            {refused.map((entry) => (
              <li key={entry.run.id}>{entry.run.terminationReason}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {log.uncertainty.length > 0 ? (
        <Panel>
          <PanelHeader
            title="What we do not know"
            hint="Ranked by what answering it would change, against what answering it would cost"
          />
          <ul className="divide-y divide-line">
            {log.uncertainty.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-ink">{item.statement}</p>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    {item.kind.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{item.rationale}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {log.plan ? (
        <Panel>
          <PanelHeader title="Validation plan" hint={log.plan.experimentType.replace(/_/g, ' ')} />
          <div className="space-y-3 px-4 py-3 text-sm text-ink-muted">
            <p className="text-ink">{log.plan.hypothesis}</p>
            <p>{log.plan.whyItMatters}</p>
            <dl className="grid grid-cols-2 gap-3 font-mono text-xs">
              <div>
                <dt className="text-ink-faint">Cost</dt>
                <dd className="text-ink">{log.plan.estimatedCost}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Days</dt>
                <dd className="text-ink">{log.plan.estimatedDays}</dd>
              </div>
            </dl>
            <div className="space-y-1">
              <p className="text-positive">Success: {log.plan.successThreshold.description}</p>
              <p className="text-negative">Failure: {log.plan.failureThreshold.description}</p>
            </div>
            {log.plan.steps.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-4">
                {log.plan.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : null}
            {log.plan.doNotBuildYet.length > 0 ? (
              <Callout tone="caution" title="Do not build these yet">
                <ul className="mt-1 space-y-1">
                  {log.plan.doNotBuildYet.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/**
 * A short, honest rendering of each role's output.
 *
 * Only the fields that carry a conclusion are shown. Dumping the whole payload
 * would look thorough and communicate nothing.
 */
function FindingSummary({
  schemaKey,
  payload,
}: {
  schemaKey: string | null;
  payload: Record<string, unknown>;
}) {
  const lines: string[] = [];

  if (schemaKey === 'investigation.market') {
    if (typeof payload.customerDescription === 'string') lines.push(`Customer: ${payload.customerDescription}`);
    if (typeof payload.problemStatement === 'string') lines.push(payload.problemStatement);
  }

  if (schemaKey === 'investigation.competitors') {
    const competitors = Array.isArray(payload.competitors) ? payload.competitors.length : 0;
    const free = Array.isArray(payload.freeAlternatives) ? (payload.freeAlternatives as string[]) : [];
    lines.push(`${competitors} existing solution(s) found.`);
    if (free.length > 0) lines.push(`Free alternatives: ${free.join(', ')}`);
    if (typeof payload.gap === 'string') lines.push(payload.gap);
  }

  if (schemaKey === 'investigation.demand') {
    const spending = Array.isArray(payload.spendingEvidence) ? payload.spendingEvidence.length : 0;
    lines.push(
      `Willingness to pay: ${String(payload.willingnessToPay ?? 'unknown').replace(/_/g, ' ')} · ${spending} piece(s) of spending evidence · ${String(payload.unpaidComplaintCount ?? 0)} complaint(s) with no observed purchase.`,
    );
  }

  if (schemaKey === 'investigation.red_team') {
    lines.push(`Verdict: ${String(payload.verdict ?? 'unknown').replace(/_/g, ' ')}`);
    if (typeof payload.verdictReason === 'string') lines.push(payload.verdictReason);
    if (typeof payload.strongestObjection === 'string') {
      lines.push(`Strongest objection: ${payload.strongestObjection}`);
    }
    if (typeof payload.verdictDowngradedFrom === 'string') {
      lines.push(
        `The model's own verdict was "${payload.verdictDowngradedFrom}", downgraded because no objection cited supplied evidence.`,
      );
    }
  }

  if (lines.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 text-xs leading-relaxed text-ink-muted">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}
