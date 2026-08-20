import type { OpportunityRow, ScoreRow } from '../../ports/repositories/opportunities';

export interface OpportunityExplanationContext {
  capabilityNames?: string[];
  assetNames?: string[];
}

export interface PlainOpportunitySummary {
  headline: string;
  customer: string;
  problem: string;
  opportunity: string;
  whyUs: string;
  nextStep: string;
  whyItAppeared: string;
  whatStillNeedsProof: string;
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
  targetCustomer?: string | null;
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
    targetCustomer?: string | null;
  };
}

function validationMove(kind: string | null | undefined, customer: string, economicProofCount: number): string {
  const buyer = customer || 'the target customer';
  if (economicProofCount > 0) {
    return `Speak to ${buyer}, confirm exactly what they currently spend or pay people to do, then test the smallest version that can replace or redirect part of that spend.`;
  }
  switch (kind) {
    case 'workaround':
      return `Find ${buyer} using this workaround, measure the time and cost it creates, then offer a small automated replacement before building a full product.`;
    case 'demand':
      return `Contact ${buyer} actively asking for this, show them the proposed solution and ask for a trial, deposit or another concrete commitment.`;
    case 'competitor_weakness':
      return `Speak to ${buyer} using the current solution, confirm this weakness is important enough to make them switch or buy an add-on, then prototype only that fix.`;
    case 'supply_gap':
      return `Confirm what ${buyer} currently wait or pay for, then test whether they will commit to an alternative before building capacity.`;
    default:
      return `Validate the exact buying behaviour of ${buyer} before committing serious build time.`;
  }
}

function manualOpening(opportunity: OpportunityRow, problem: string): string {
  const customer = oneLine(opportunity.targetCustomer);
  const thesis = oneLine(opportunity.thesis);
  if (customer && problem) return `Solve this specific problem for ${customer}: ${problem}`;
  if (customer && thesis) return `For ${customer}: ${thesis}`;
  return thesis || 'No concrete commercial opening has been recorded yet.';
}

function whyUs(context: OpportunityExplanationContext | undefined): string {
  const capabilities = [...new Set((context?.capabilityNames ?? []).map(oneLine).filter(Boolean))].slice(0, 4);
  const assets = [...new Set((context?.assetNames ?? []).map(oneLine).filter(Boolean))].slice(0, 2);

  if (capabilities.length > 0 && assets.length > 0) {
    return `We can build and test this ourselves because our recorded capabilities include ${capabilities.join(', ')}. We also have reusable assets such as ${assets.join(', ')}, which may reduce build time if relevant.`;
  }
  if (capabilities.length > 0) {
    return `We are not limited to products we already own. Our recorded capabilities include ${capabilities.join(', ')}, so software, automation and AI-heavy solutions can be built and tested by us when the opportunity is strong enough.`;
  }
  if (assets.length > 0) {
    return `We already have reusable assets such as ${assets.join(', ')}, which may shorten delivery, but Radar still needs a stronger capability match before claiming a major execution advantage.`;
  }
  return 'Radar has not yet recorded enough internal capability data to claim a specific execution advantage.';
}

/** Human-facing explanation of an opportunity that has earned its place in Opps. */
export function explainOpportunity(
  opportunity: OpportunityRow,
  score?: ScoreRow | null,
  context?: OpportunityExplanationContext,
): PlainOpportunitySummary {
  const rawTitle = oneLine(opportunity.title);
  const headline = cleanHeadline(rawTitle);
  const problem = cleanProblem(opportunity.problemStatement);
  const framing = autoFramingEvidence(opportunity);
  const qualification = commercialQualification(opportunity);
  const isAuto = opportunity.createdBy === 'auto';
  const customer = oneLine(opportunity.targetCustomer) || oneLine(qualification.targetCustomer);
  const qualified = !isAuto || qualification.eligible === true;
  const looksLikeSourceHeadline = SOURCE_HEADLINE.test(rawTitle);
  const problemEstablished = Boolean(problem) && Boolean(customer) && qualified && !looksLikeSourceHeadline;

  if (isAuto && !qualified) {
    return {
      headline: `Signal only: ${headline}`,
      customer: customer || 'Buyer not established',
      problem: problem || 'Radar has not established a genuine customer problem from this activity.',
      opportunity: 'This has not passed the commercial opportunity gate and should not appear in the normal Opportunity feed.',
      whyUs: whyUs(context),
      nextStep: 'Keep it as market intelligence unless stronger buyer, problem and commercial evidence appears.',
      whyItAppeared: qualification.reason || 'This was created by an older automatic-framing rule and is being re-evaluated.',
      whatStillNeedsProof: 'A named buyer, a costly or painful problem, and real commercial behaviour are still missing.',
      problemEstablished: false,
    };
  }

  const problemText = problemEstablished
    ? `${customer}: ${problem}`
    : problem || `Radar has not yet established a specific customer problem behind “${headline}”.`;

  const opening = oneLine(qualification.specificOpening);
  const opportunityText = opening || (isAuto ? oneLine(opportunity.thesis) : manualOpening(opportunity, problem));

  let nextStep: string;
  if (!score) {
    nextStep = validationMove(qualification.strongestSignalType, customer, qualification.economicProofCount ?? 0);
  } else if ((score.attractiveness ?? 0) >= 60 && score.confidence >= 0.5) {
    nextStep = `Run the smallest real-world sales or usage test with ${customer || 'the target customer'} that can prove this opening before a full build.`;
  } else if ((score.attractiveness ?? 0) >= 60) {
    nextStep = `The opening looks attractive but is not proven enough. Test the most important missing assumption with ${customer || 'real buyers'} first.`;
  } else {
    nextStep = 'Do not commit serious build time yet. Keep watching for stronger commercial evidence or a cheaper validation route.';
  }

  const proofParts: string[] = [];
  if (typeof qualification.problemProofCount === 'number') proofParts.push(`${qualification.problemProofCount} genuine problem proof item${qualification.problemProofCount === 1 ? '' : 's'}`);
  if (typeof qualification.commercialProofCount === 'number') proofParts.push(`${qualification.commercialProofCount} commercial-behaviour signal${qualification.commercialProofCount === 1 ? '' : 's'}`);
  if (typeof qualification.economicProofCount === 'number' && qualification.economicProofCount > 0) proofParts.push(`${qualification.economicProofCount} direct economic signal${qualification.economicProofCount === 1 ? '' : 's'}`);
  if (typeof qualification.independentOrigins === 'number') proofParts.push(`${qualification.independentOrigins} independent origin${qualification.independentOrigins === 1 ? '' : 's'}`);

  const fallbackEvidenceParts: string[] = [];
  if (typeof framing.uniqueEvidenceCount === 'number') fallbackEvidenceParts.push(`${framing.uniqueEvidenceCount} distinct evidence item${framing.uniqueEvidenceCount === 1 ? '' : 's'}`);
  if (typeof framing.independentSourceCount === 'number') fallbackEvidenceParts.push(`${framing.independentSourceCount} independent source${framing.independentSourceCount === 1 ? '' : 's'}`);

  const whyItAppeared = proofParts.length > 0
    ? `Radar only let this into Opportunities after finding ${proofParts.join(', ')}.`
    : fallbackEvidenceParts.length > 0
      ? `Radar surfaced this because it found ${fallbackEvidenceParts.join(' across ')}.`
      : oneLine(opportunity.whyNow) || 'Radar surfaced this because the underlying evidence pattern crossed its threshold.';

  const whatStillNeedsProof = !customer
    ? 'Who actually buys this is still not established.'
    : (qualification.economicProofCount ?? 0) > 0
      ? `Confirm that ${customer} would switch, buy or commit to the proposed solution rather than merely agreeing the problem exists.`
      : `Confirm how much this problem costs ${customer} today and obtain a real buying commitment before a full build.`;

  return {
    headline,
    customer: customer || 'Buyer not established',
    problem: problemText,
    opportunity: opportunityText,
    whyUs: whyUs(context),
    nextStep,
    whyItAppeared,
    whatStillNeedsProof,
    problemEstablished,
  };
}
