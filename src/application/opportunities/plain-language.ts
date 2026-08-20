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

function commercialQualification(opportunity: OpportunityRow): {
  eligible?: boolean;
  reason?: string;
  problemProofCount?: number;
  commercialProofCount?: number;
  economicProofCount?: number;
  independentOrigins?: number;
  strongestSignalType?: string | null;
  specificOpening?: string;
} {
  const raw = opportunity.notes?.commercialQualification;
  if (!raw || typeof raw !== 'object') return {};
  return raw as {
    eligible?: boolean;
    reason?: string;
    problemProofCount?: number;
    commercialProofCount?: number;
    economicProofCount?: number;
    independentOrigins?: number;
    strongestSignalType?: string | null;
    specificOpening?: string;
  };
}

function validationMove(kind: string | null | undefined, economicProofCount: number): string {
  if (economicProofCount > 0) {
    return 'Verify the buyer, current spend and buying trigger, then test the smallest version that can win or redirect some of that existing spend.';
  }
  switch (kind) {
    case 'workaround':
      return 'Find people using this workaround, measure the time/cost it creates, and offer a small automated replacement before building a full product.';
    case 'demand':
      return 'Contact the people actively asking for this, show them the proposed solution and ask for a trial, deposit or another concrete commitment.';
    case 'competitor_weakness':
      return 'Speak to users of the current solution, confirm this weakness is important enough to make them switch or buy an add-on, then prototype only that fix.';
    case 'supply_gap':
      return 'Confirm the shortage, what buyers currently wait or pay for, and whether they will commit to an alternative before adding capacity.';
    default:
      return 'Validate the exact buyer and commercial behaviour behind this opening before committing build time.';
  }
}

/** Human-facing explanation of an opportunity that has earned its place in Opps. */
export function explainOpportunity(
  opportunity: OpportunityRow,
  score?: ScoreRow | null,
): PlainOpportunitySummary {
  const rawTitle = oneLine(opportunity.title);
  const headline = cleanHeadline(rawTitle);
  const problem = cleanProblem(opportunity.problemStatement);
  const framing = autoFramingEvidence(opportunity);
  const qualification = commercialQualification(opportunity);
  const isAuto = opportunity.createdBy === 'auto';
  const qualified = !isAuto || qualification.eligible === true;
  const looksLikeSourceHeadline = SOURCE_HEADLINE.test(rawTitle);
  const problemEstablished = Boolean(problem) && qualified && !looksLikeSourceHeadline;

  if (isAuto && !qualified) {
    return {
      headline: `Signal only: ${headline}`,
      problem: problem || 'Radar has not established a genuine customer problem from this activity.',
      opportunity: 'This has not passed the commercial opportunity gate and should not appear in the normal Opportunity feed.',
      nextStep: 'Keep it as market intelligence unless stronger problem and commercial evidence appears.',
      whyItAppeared: qualification.reason || 'This was created by an older automatic-framing rule and is being re-evaluated.',
      problemEstablished: false,
    };
  }

  const problemText = problemEstablished
    ? problem
    : problem || `Radar has not yet established the specific customer problem behind “${headline}”.`;

  const opening = oneLine(qualification.specificOpening);
  const opportunityText = opening || oneLine(opportunity.thesis) || 'No concrete commercial opening has been recorded yet.';

  let nextStep: string;
  if (!score) {
    nextStep = validationMove(
      qualification.strongestSignalType,
      qualification.economicProofCount ?? 0,
    );
  } else if ((score.attractiveness ?? 0) >= 60 && score.confidence >= 0.5) {
    nextStep = 'Run the smallest real-world sales or usage test that can prove this opening before committing to a full build.';
  } else if ((score.attractiveness ?? 0) >= 60) {
    nextStep = 'The opening looks attractive but is not proven enough. Test the most important missing assumption with real buyers first.';
  } else {
    nextStep = 'Do not commit build time yet. Keep watching for stronger commercial evidence or a cheaper validation route.';
  }

  const proofParts: string[] = [];
  if (typeof qualification.problemProofCount === 'number') {
    proofParts.push(`${qualification.problemProofCount} problem proof item${qualification.problemProofCount === 1 ? '' : 's'}`);
  }
  if (typeof qualification.commercialProofCount === 'number') {
    proofParts.push(`${qualification.commercialProofCount} commercial signal${qualification.commercialProofCount === 1 ? '' : 's'}`);
  }
  if (typeof qualification.independentOrigins === 'number') {
    proofParts.push(`${qualification.independentOrigins} independent origin${qualification.independentOrigins === 1 ? '' : 's'}`);
  }

  const fallbackEvidenceParts: string[] = [];
  if (typeof framing.uniqueEvidenceCount === 'number') {
    fallbackEvidenceParts.push(`${framing.uniqueEvidenceCount} distinct evidence item${framing.uniqueEvidenceCount === 1 ? '' : 's'}`);
  }
  if (typeof framing.independentSourceCount === 'number') {
    fallbackEvidenceParts.push(`${framing.independentSourceCount} independent source${framing.independentSourceCount === 1 ? '' : 's'}`);
  }

  const whyItAppeared = proofParts.length > 0
    ? `This reached Opportunities because Radar found ${proofParts.join(', ')}.`
    : fallbackEvidenceParts.length > 0
      ? `Radar surfaced this because it found ${fallbackEvidenceParts.join(' across ')}.`
      : oneLine(opportunity.whyNow) || 'Radar surfaced this because the underlying evidence pattern crossed its threshold.';

  return {
    headline,
    problem: problemText,
    opportunity: opportunityText,
    nextStep,
    whyItAppeared,
    problemEstablished,
  };
}
