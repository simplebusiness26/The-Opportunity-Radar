import type { OpportunityRow, ScoreRow } from '../../ports/repositories/opportunities';

export interface PlainOpportunitySummary {
  headline: string;
  problem: string;
  opportunity: string;
  nextStep: string;
  whyItAppeared: string;
  problemEstablished: boolean;
}

const SOURCE_HEADLINE = /^(show|ask|tell|launch)\s+hn\s*:\s*/i;
const PROBLEM_PREFIX = /^Repeated independent evidence indicates this problem:\s*/i;

function oneLine(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanHeadline(value: string): string {
  return oneLine(value).replace(SOURCE_HEADLINE, '').trim() || 'Unclear market signal';
}

function cleanProblem(value: string | null): string {
  return oneLine(value).replace(PROBLEM_PREFIX, '').trim();
}

function autoFramingEvidence(opportunity: OpportunityRow): {
  uniqueEvidenceCount?: number;
  independentSourceCount?: number;
  clusterConfidence?: number;
} {
  const raw = opportunity.notes?.autoFraming;
  if (!raw || typeof raw !== 'object') return {};
  return raw as {
    uniqueEvidenceCount?: number;
    independentSourceCount?: number;
    clusterConfidence?: number;
  };
}

/**
 * Human-facing explanation of a machine-framed opportunity.
 *
 * Early Radar items can be little more than repeated market activity. This
 * helper deliberately says "problem not established" instead of turning a
 * product announcement or source headline into a fake customer pain point.
 */
export function explainOpportunity(
  opportunity: OpportunityRow,
  score?: ScoreRow | null,
): PlainOpportunitySummary {
  const rawTitle = oneLine(opportunity.title);
  const headline = cleanHeadline(rawTitle);
  const problem = cleanProblem(opportunity.problemStatement);
  const looksLikeSourceHeadline = SOURCE_HEADLINE.test(rawTitle);
  const problemEstablished = Boolean(problem) && !looksLikeSourceHeadline;
  const customer = oneLine(opportunity.targetCustomer);
  const framing = autoFramingEvidence(opportunity);

  const problemText = problemEstablished
    ? problem
    : `Radar has detected repeated activity around “${headline}”, but it has not yet established the specific customer problem behind it.`;

  const opportunityText = problemEstablished
    ? customer
      ? `There may be a commercial opening to solve this problem for ${customer}.`
      : 'There may be a commercial opening to turn this repeated problem into a useful product or service.'
    : 'The opportunity right now is to find out whether this activity points to a real unmet need that people would value enough to pay to solve.';

  let nextStep: string;
  if (!score) {
    nextStep = problemEstablished
      ? 'Clarify who has the problem, what they use today and whether they would pay. Do not build the full solution yet.'
      : 'First identify the customer, the actual pain point and a payment signal. If those are not found, drop it rather than build it.';
  } else if ((score.attractiveness ?? 0) >= 60 && score.confidence >= 0.5) {
    nextStep = 'Test the smallest sellable version with real users or buyers before committing to a full build.';
  } else if ((score.attractiveness ?? 0) >= 60) {
    nextStep = 'It looks potentially attractive, but confidence is still low. Run the cheapest useful validation test before building.';
  } else {
    nextStep = 'Keep watching and gather stronger evidence. It does not currently justify committing build time.';
  }

  const evidenceParts: string[] = [];
  if (typeof framing.uniqueEvidenceCount === 'number') {
    evidenceParts.push(`${framing.uniqueEvidenceCount} distinct evidence item${framing.uniqueEvidenceCount === 1 ? '' : 's'}`);
  }
  if (typeof framing.independentSourceCount === 'number') {
    evidenceParts.push(`${framing.independentSourceCount} independent source${framing.independentSourceCount === 1 ? '' : 's'}`);
  }

  const whyItAppeared = evidenceParts.length > 0
    ? `Radar surfaced this because it found ${evidenceParts.join(' across ')}.`
    : oneLine(opportunity.whyNow) || 'Radar surfaced this because the underlying evidence pattern crossed its detection threshold.';

  return {
    headline: problemEstablished ? headline : `Investigate demand around: ${headline}`,
    problem: problemText,
    opportunity: opportunityText,
    nextStep,
    whyItAppeared,
    problemEstablished,
  };
}
