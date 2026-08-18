import type { ActorCtx } from '../../domain/types/identity';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';

export interface AlertDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface AlertEvaluation {
  considered: number;
  raised: number;
  /** Conditions that were true but had already been reported recently. */
  suppressed: number;
}

/**
 * Thresholds an alert has to clear.
 *
 * The hard part of alerting is not detecting change, it is refusing to mention
 * most of it. An alert that fires often is an alert that gets ignored, and an
 * ignored alert is worse than none because it teaches the owner not to look.
 */
export const ALERT_RULES = {
  /** A score must move this far before it is worth interrupting anyone. */
  scoreJump: 8,
  /** Confidence moving is more meaningful than score moving, so a lower bar. */
  confidenceJump: 0.15,
  /** Above this, a candidate is worth surfacing even without a jump. */
  strongScore: 80,
  /** Counter-evidence that drags a previously strong thesis down. */
  scoreDropFromStrong: 10,
  /** Do not repeat the same alert within this window. */
  suppressSeconds: 12 * 60 * 60,
} as const;

/**
 * Raises alerts for changes that genuinely warrant attention.
 *
 * Everything here reads from `score_deltas`, which is computed deterministically
 * when a score is recomputed. No model decides what is notable, so the same
 * change always produces the same alert -- and no alert can be raised about a
 * change that did not actually happen.
 */
export async function evaluateAlerts(deps: AlertDeps, ctx: ActorCtx): Promise<AlertEvaluation> {
  const now = deps.clock.now();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const deltas = await deps.repos.scores.recentDeltas(ctx.workspaceId, since, 100);
  const evaluation: AlertEvaluation = { considered: deltas.length, raised: 0, suppressed: 0 };

  for (const delta of deltas) {
    const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, delta.opportunityId);
    if (!opportunity) continue;

    // A delta with no resulting value describes a score that was removed rather
    // than moved; there is nothing to alert about.
    if (delta.toValue === null) continue;

    const alert = describeAlert({ ...delta, toValue: delta.toValue }, opportunity.title);
    if (!alert) continue;

    const raised = await deps.repos.alerts.raise(
      ctx.workspaceId,
      {
        kind: alert.kind,
        severity: alert.severity,
        subjectType: 'opportunity',
        subjectId: delta.opportunityId,
        title: alert.title,
        body: alert.body,
        action: alert.action,
        dedupeKey: `${alert.kind}:${delta.opportunityId}:${delta.toScoreId}`,
        suppressForSeconds: ALERT_RULES.suppressSeconds,
      },
      now,
    );

    if (raised) evaluation.raised += 1;
    else evaluation.suppressed += 1;
  }

  return evaluation;
}

interface AlertShape {
  kind: string;
  severity: 'info' | 'notable' | 'urgent';
  title: string;
  body: string;
  action: string | null;
}

/**
 * Decides whether one score movement is worth mentioning, and how to say it.
 *
 * Returns null for the ordinary case, which is most of them.
 */
export function describeAlert(
  delta: {
    composite: string;
    delta: number;
    toValue: number;
    cause: string;
    topDrivers: Array<{ key: string; label: string; delta: number }>;
    opportunityId: string;
    toScoreId: string;
  },
  opportunityTitle: string,
): AlertShape | null {
  const drivers = delta.topDrivers
    .slice(0, 2)
    .map((driver) => driver.label)
    .join(' and ');
  const because = drivers ? ` Driven by ${drivers}.` : '';

  if (delta.composite === 'confidence') {
    if (Math.abs(delta.delta) < ALERT_RULES.confidenceJump) return null;

    const rising = delta.delta > 0;
    return {
      kind: rising ? 'confidence.rose' : 'confidence.fell',
      severity: 'notable',
      title: rising
        ? `Confidence rose in ${opportunityTitle}`
        : `Confidence fell in ${opportunityTitle}`,
      body: rising
        ? `Confidence moved to ${Math.round(delta.toValue * 100)}%.${because} The thesis is better supported than it was.`
        : `Confidence dropped to ${Math.round(delta.toValue * 100)}%.${because} What was believed is now less well supported.`,
      action: rising
        ? 'Check whether this is now worth validating.'
        : 'Look at what weakened before spending anything further on it.',
    };
  }

  if (delta.composite !== 'attractiveness') return null;

  if (delta.cause === 'counter_evidence' && delta.delta <= -ALERT_RULES.scoreDropFromStrong) {
    return {
      kind: 'opportunity.weakened',
      severity: 'urgent',
      title: `Counter-evidence weakened ${opportunityTitle}`,
      body: `The score fell ${Math.abs(Math.round(delta.delta))} points to ${Math.round(delta.toValue)}.${because}`,
      action: 'Read the evidence against before committing further resources.',
    };
  }

  if (delta.delta >= ALERT_RULES.scoreJump && delta.toValue >= ALERT_RULES.strongScore) {
    return {
      kind: 'opportunity.strengthened',
      severity: 'notable',
      title: `${opportunityTitle} is now scoring ${Math.round(delta.toValue)}`,
      body: `Up ${Math.round(delta.delta)} points.${because}`,
      action: 'Consider what the cheapest test of it would be.',
    };
  }

  return null;
}
