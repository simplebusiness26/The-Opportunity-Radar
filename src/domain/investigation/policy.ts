/**
 * What deserves expensive investigation.
 *
 * Researching everything is how a system with an AI budget spends it in a week
 * and learns nothing. This gate is deliberately conservative: cheap, shallow
 * assessment happens for everything, and each further stage has to be earned.
 */

export type DepthStage = 'watch' | 'collect_more' | 'investigate' | 'red_team' | 'propose_validation';

export interface CandidateState {
  uniqueEvidenceCount: number;
  independentSourceCount: number;
  /** Deterministic score, before any AI has looked at it. */
  preliminaryScore: number;
  confidence: number;
  /** Whether spending has actually been observed, not merely complained about. */
  hasSpendingEvidence: boolean;
  /** Which investigation roles have already run. */
  completedRoles: string[];
  /** Whether the red team already returned a fatal verdict. */
  redTeamVerdict: 'fatal' | 'serious_but_testable' | 'survivable' | 'no_material_objection' | null;
}

export interface DepthDecision {
  stage: DepthStage;
  /** Whether to spend money on the next stage now. */
  proceed: boolean;
  reason: string;
  /** What would move it to the next stage, when it is not ready. */
  needed: string | null;
}

export interface DepthThresholds {
  minEvidenceToInvestigate: number;
  minIndependentSourcesToInvestigate: number;
  minScoreToInvestigate: number;
  minScoreToRedTeam: number;
  minConfidenceToPropose: number;
}

export const DEFAULT_DEPTH: DepthThresholds = {
  minEvidenceToInvestigate: 3,
  minIndependentSourcesToInvestigate: 2,
  minScoreToInvestigate: 45,
  minScoreToRedTeam: 55,
  minConfidenceToPropose: 0.35,
};

/**
 * Decides how far to take a candidate.
 *
 * Returns the stage it has earned, and refuses to skip ahead. The refusals
 * matter more than the approvals: most candidates should stop early, and a
 * policy that lets everything through is not a policy.
 */
export function decideDepth(
  state: CandidateState,
  thresholds: DepthThresholds = DEFAULT_DEPTH,
): DepthDecision {
  // A fatal red-team verdict ends it. Continuing to spend on something already
  // argued to be dead is the most wasteful thing this system could do.
  if (state.redTeamVerdict === 'fatal') {
    return {
      stage: 'watch',
      proceed: false,
      reason: 'The red team found a fatal objection. Nothing further is worth spending on this.',
      needed: 'New evidence that answers the objection would reopen it.',
    };
  }

  if (state.independentSourceCount === 0) {
    return {
      stage: 'watch',
      proceed: false,
      reason:
        'Nothing here has been independently corroborated, so investigation would be researching one party’s opinion.',
      needed: 'At least one independent source.',
    };
  }

  if (
    state.uniqueEvidenceCount < thresholds.minEvidenceToInvestigate ||
    state.independentSourceCount < thresholds.minIndependentSourcesToInvestigate
  ) {
    const missingEvidence = Math.max(
      0,
      thresholds.minEvidenceToInvestigate - state.uniqueEvidenceCount,
    );
    const missingSources = Math.max(
      0,
      thresholds.minIndependentSourcesToInvestigate - state.independentSourceCount,
    );

    return {
      stage: 'collect_more',
      proceed: false,
      reason: 'There is not yet enough independent evidence to justify paid research.',
      needed: [
        missingEvidence > 0 ? `${missingEvidence} more unique piece(s) of evidence` : null,
        missingSources > 0 ? `${missingSources} more independent source(s)` : null,
      ]
        .filter(Boolean)
        .join(' and '),
    };
  }

  if (state.preliminaryScore < thresholds.minScoreToInvestigate) {
    return {
      stage: 'watch',
      proceed: false,
      reason: `Scores ${Math.round(state.preliminaryScore)} before any research, which does not justify paying for more.`,
      needed: `A preliminary score above ${thresholds.minScoreToInvestigate}.`,
    };
  }

  const completed = new Set(state.completedRoles);

  if (!completed.has('market') || !completed.has('competitors') || !completed.has('demand')) {
    return {
      stage: 'investigate',
      proceed: true,
      reason: 'Enough independent evidence to justify understanding the market properly.',
      needed: null,
    };
  }

  if (!completed.has('red_team')) {
    if (state.preliminaryScore < thresholds.minScoreToRedTeam) {
      return {
        stage: 'watch',
        proceed: false,
        reason: `Investigation left it at ${Math.round(state.preliminaryScore)}, below the bar for the expensive red-team pass.`,
        needed: `A score above ${thresholds.minScoreToRedTeam}.`,
      };
    }

    return {
      stage: 'red_team',
      proceed: true,
      reason: 'It survived investigation and is worth a serious attempt to kill.',
      needed: null,
    };
  }

  if (!completed.has('validation')) {
    if (state.confidence < thresholds.minConfidenceToPropose) {
      return {
        stage: 'collect_more',
        proceed: false,
        reason: `Confidence is ${Math.round(state.confidence * 100)}%, too low to design a meaningful test around.`,
        needed: 'More corroborating evidence before an experiment can be aimed properly.',
      };
    }

    return {
      stage: 'propose_validation',
      proceed: true,
      reason: 'It survived the red team. The next useful step is a cheap test, not more research.',
      needed: null,
    };
  }

  return {
    stage: 'propose_validation',
    proceed: false,
    reason: 'Everything that can be established from desk research has been. The next step is real-world evidence.',
    needed: 'Run the proposed experiment.',
  };
}

/**
 * Value of information: which unknown is worth resolving next.
 *
 * Impact over cost, so a cheap question that would change the decision beats an
 * expensive one that would merely be interesting. This is what stops research
 * following whatever is easiest to look up.
 */
export interface UncertaintyInput {
  id: string;
  statement: string;
  kind: 'known_fact' | 'assumption' | 'unknown' | 'critical_unknown' | 'evidence_gap';
  impact: number;
  resolvability: number;
  costToResolve: number | null;
  daysToResolve: number | null;
}

export interface RankedUncertainty extends UncertaintyInput {
  voiScore: number;
  rationale: string;
}

export function rankByValueOfInformation(
  items: readonly UncertaintyInput[],
): RankedUncertainty[] {
  return items
    .filter((item) => item.kind !== 'known_fact')
    .map((item) => {
      // Cost in days, since the scarcest resource for a small team is attention
      // rather than money. Money is folded in at a rough exchange rate.
      const days = item.daysToResolve ?? 2;
      const money = item.costToResolve ?? 0;
      const effort = Math.max(0.5, days + money / 250);

      // A critical unknown is weighted above an ordinary one: the point of the
      // ranking is to find the question whose answer changes the decision.
      const criticality = item.kind === 'critical_unknown' ? 1.6 : item.kind === 'assumption' ? 1.1 : 1;

      const voiScore = Number(
        ((item.impact * item.resolvability * criticality) / effort).toFixed(4),
      );

      return {
        ...item,
        voiScore,
        rationale: describeVoi(item, effort, voiScore),
      };
    })
    .sort((a, b) => b.voiScore - a.voiScore);
}

function describeVoi(item: UncertaintyInput, effort: number, score: number): string {
  if (item.resolvability < 0.25) {
    return `Would change the decision, but there is no cheap way to find out (${score.toFixed(2)}).`;
  }
  if (item.impact < 0.3) {
    return `Answerable, but the answer would not change what to do (${score.toFixed(2)}).`;
  }
  return `Roughly ${effort.toFixed(1)} day(s) of effort to resolve something that would change the decision (${score.toFixed(2)}).`;
}

/**
 * Whether the red team's verdict should stop the opportunity.
 *
 * Being able to say "reject" is the point. A system that always finds a way
 * forward is a system telling its owner what they want to hear.
 */
export function shouldReject(input: {
  redTeamVerdict: string | null;
  fatalObjectionCount: number;
  willingnessToPay: string | null;
  hasFreeAlternative: boolean;
  complaintCount: number;
}): { reject: boolean; reason: string | null } {
  if (input.redTeamVerdict === 'fatal' || input.fatalObjectionCount > 0) {
    return {
      reject: true,
      reason: 'The red team found an objection it judged fatal, supported by the evidence.',
    };
  }

  // The specific failure this product exists to prevent: loud, widespread
  // complaint with nobody paying and a free alternative that is good enough.
  if (
    input.willingnessToPay === 'absent' &&
    input.hasFreeAlternative &&
    input.complaintCount >= 3
  ) {
    return {
      reject: true,
      reason:
        'People complain about this but no evidence shows anyone paying to fix it, and a free alternative already exists. Volume of complaint is not demand.',
    };
  }

  if (input.willingnessToPay === 'contradicted') {
    return {
      reject: true,
      reason: 'The evidence actively indicates people will not pay for this.',
    };
  }

  return { reject: false, reason: null };
}
