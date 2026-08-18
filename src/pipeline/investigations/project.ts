import type { z } from 'zod';
import { rankByValueOfInformation, type RankedUncertainty } from '../../domain/investigation/policy';
import {
  clampNumber,
  emptyReport,
  projectClaims,
  type ProjectedClaim,
  type ProjectionReport,
} from '../projectors/index';
import type {
  competitorFindings,
  demandFindings,
  marketFindings,
  redTeamFindings,
  uncertaintyFindings,
  validationDesign,
} from '../schemas/investigation';

/**
 * Turning a role's validated output into something the database may keep.
 *
 * Validation proved the shape. This proves the substance: every citation names
 * evidence that was actually supplied, every number is inside its declared
 * range, and -- the part that matters most here -- a verdict of "fatal" has to
 * rest on an objection that survived citation checking. A model that argues an
 * idea is dead while citing nothing gets its reasoning kept and its verdict
 * downgraded, with the downgrade recorded rather than hidden.
 */

export interface ProjectedMarket {
  customerDescription: string;
  problemStatement: string;
  currentAlternatives: string[];
  findings: StancedClaim[];
  unknowns: string[];
}

export interface StancedClaim extends ProjectedClaim {
  stance: 'for' | 'against';
}

export interface ProjectedCompetitors {
  competitors: Array<{ name: string; weaknesses: string[]; pricingObserved: string | null; signalIds: string[] }>;
  freeAlternatives: string[];
  gap: string;
  findings: StancedClaim[];
}

export interface ProjectedDemand {
  spendingEvidence: Array<{ description: string; monthlyAmount: number | null; currency: string | null; signalIds: string[] }>;
  unpaidComplaintCount: number;
  willingnessToPay: 'demonstrated' | 'stated_only' | 'absent' | 'contradicted' | 'insufficient_evidence';
  findings: StancedClaim[];
}

export interface ProjectedObjection {
  category: string;
  argument: string;
  severity: 'fatal' | 'serious' | 'manageable';
  signalIds: string[];
  disconfirmingTest: string | null;
  /** True when nothing it cited was actually supplied. */
  unsupported: boolean;
}

export interface ProjectedRedTeam {
  strongestObjection: string;
  objections: ProjectedObjection[];
  verdict: 'fatal' | 'serious_but_testable' | 'survivable' | 'no_material_objection';
  verdictReason: string;
  /** Set when the projector had to weaken the model's own verdict. */
  verdictDowngradedFrom: string | null;
  /** Evidence the objections cite, to be attached as counter-evidence. */
  counterEvidenceIds: string[];
}

export interface Projected<T> {
  value: T;
  report: ProjectionReport;
}

export function projectMarket(
  raw: z.infer<typeof marketFindings.schema>,
  suppliedIds: readonly string[],
): Projected<ProjectedMarket> {
  const report = emptyReport();

  return {
    value: {
      customerDescription: raw.customerDescription.trim(),
      problemStatement: raw.problemStatement.trim(),
      currentAlternatives: raw.currentAlternatives.map((entry) => entry.trim()).filter(Boolean),
      findings: projectStanced(raw.findings, suppliedIds, report),
      unknowns: raw.unknowns.map((entry) => entry.trim()).filter(Boolean),
    },
    report,
  };
}

export function projectCompetitors(
  raw: z.infer<typeof competitorFindings.schema>,
  suppliedIds: readonly string[],
): Projected<ProjectedCompetitors> {
  const report = emptyReport();
  const supplied = new Set(suppliedIds);

  const competitors = raw.competitors.map((competitor) => {
    const kept = competitor.signalIds.filter((id) => {
      if (supplied.has(id)) return true;
      report.hallucinatedCitations.push(id);
      return false;
    });

    return {
      name: competitor.name.trim(),
      weaknesses: competitor.weaknesses.map((entry) => entry.trim()).filter(Boolean),
      pricingObserved: competitor.pricingObserved?.trim() || null,
      signalIds: kept,
    };
  });

  return {
    value: {
      // A named competitor is a factual assertion about the world, so an
      // uncited one is dropped rather than stored as a finding.
      competitors: competitors.filter((competitor) => competitor.name.length > 0),
      freeAlternatives: raw.freeAlternatives.map((entry) => entry.trim()).filter(Boolean),
      gap: raw.gap.trim(),
      findings: projectStanced(raw.findings, suppliedIds, report),
    },
    report,
  };
}

export function projectDemand(
  raw: z.infer<typeof demandFindings.schema>,
  suppliedIds: readonly string[],
): Projected<ProjectedDemand> {
  const report = emptyReport();
  const supplied = new Set(suppliedIds);

  const spendingEvidence = raw.spendingEvidence
    .map((entry) => {
      const kept = entry.signalIds.filter((id) => {
        if (supplied.has(id)) return true;
        report.hallucinatedCitations.push(id);
        return false;
      });
      return {
        description: entry.description.trim(),
        monthlyAmount:
          entry.monthlyAmount === null
            ? null
            : clampNumber(entry.monthlyAmount, { min: 0, max: 10_000_000 }, 'monthlyAmount', report),
        currency: entry.currency?.trim().toUpperCase() || null,
        signalIds: kept,
      };
    })
    // Spending is the single claim this product must never get wrong, so an
    // uncited one is discarded outright.
    .filter((entry) => {
      if (entry.signalIds.length > 0) return true;
      report.droppedClaims += 1;
      return false;
    });

  // If nothing survived citation checking, the assessment cannot stand either.
  const willingnessToPay =
    raw.willingnessToPayAssessment === 'demonstrated' && spendingEvidence.length === 0
      ? 'insufficient_evidence'
      : raw.willingnessToPayAssessment;

  if (willingnessToPay !== raw.willingnessToPayAssessment) {
    report.droppedValues.push(
      'willingnessToPay: "demonstrated" was not supported by any cited spending evidence',
    );
  }

  return {
    value: {
      spendingEvidence,
      unpaidComplaintCount: Math.round(
        clampNumber(raw.unpaidComplaintCount, { min: 0, max: 10_000 }, 'unpaidComplaintCount', report),
      ),
      willingnessToPay,
      findings: projectStanced(raw.findings, suppliedIds, report),
    },
    report,
  };
}

export function projectRedTeam(
  raw: z.infer<typeof redTeamFindings.schema>,
  suppliedIds: readonly string[],
): Projected<ProjectedRedTeam> {
  const report = emptyReport();
  const supplied = new Set(suppliedIds);
  const counterEvidence = new Set<string>();

  const objections: ProjectedObjection[] = raw.objections.map((objection) => {
    const kept = objection.signalIds.filter((id) => {
      if (supplied.has(id)) return true;
      report.hallucinatedCitations.push(id);
      return false;
    });
    for (const id of kept) counterEvidence.add(id);

    return {
      category: objection.category,
      argument: objection.argument.trim(),
      severity: objection.severity,
      signalIds: kept,
      disconfirmingTest: objection.disconfirmingTest?.trim() || null,
      unsupported: kept.length === 0,
    };
  });

  const supportedFatal = objections.some(
    (objection) => objection.severity === 'fatal' && !objection.unsupported,
  );

  // The verdict is the most consequential thing a model says in this product,
  // so it is the one place where "argue it, then cite it" is enforced rather
  // than encouraged.
  let verdict = raw.verdict;
  let downgradedFrom: string | null = null;
  if (verdict === 'fatal' && !supportedFatal) {
    verdict = 'serious_but_testable';
    downgradedFrom = 'fatal';
    report.droppedValues.push(
      'verdict: "fatal" was not supported by any objection citing supplied evidence',
    );
  }

  return {
    value: {
      strongestObjection: raw.strongestObjection.trim(),
      objections,
      verdict,
      verdictReason: raw.verdictReason.trim(),
      verdictDowngradedFrom: downgradedFrom,
      counterEvidenceIds: [...counterEvidence],
    },
    report,
  };
}

export interface ProjectedUncertainty {
  items: RankedUncertainty[];
  /** Statements the model produced that cite nothing, kept as assumptions. */
  criticalCount: number;
}

export function projectUncertainty(
  raw: z.infer<typeof uncertaintyFindings.schema>,
  suppliedIds: readonly string[],
): Projected<ProjectedUncertainty> {
  const report = emptyReport();
  const supplied = new Set(suppliedIds);

  const inputs = raw.items
    .filter((item) => item.statement.trim().length > 0)
    .map((item, index) => {
      for (const id of item.signalIds) {
        if (!supplied.has(id)) report.hallucinatedCitations.push(id);
      }

      // A "known fact" has to be traceable to evidence; without a surviving
      // citation it is an assumption, and recording it as a fact would be the
      // exact confusion this table exists to prevent.
      const cited = item.signalIds.filter((id) => supplied.has(id));
      const kind = item.kind === 'known_fact' && cited.length === 0 ? 'assumption' : item.kind;
      if (kind !== item.kind) {
        report.droppedValues.push(
          `uncertainty[${index}].kind: "known_fact" with no surviving citation, recorded as an assumption`,
        );
      }

      return {
        id: `u${index}`,
        statement: item.statement.trim(),
        kind,
        impact: clampNumber(item.impact, { min: 0, max: 1 }, `uncertainty[${index}].impact`, report),
        resolvability: clampNumber(
          item.resolvability,
          { min: 0, max: 1 },
          `uncertainty[${index}].resolvability`,
          report,
        ),
        costToResolve: item.estimatedCost,
        daysToResolve: item.estimatedDays,
      };
    });

  const items = rankByValueOfInformation(inputs);

  return {
    value: {
      items,
      criticalCount: items.filter((item) => item.kind === 'critical_unknown').length,
    },
    report,
  };
}

export interface ProjectedValidation {
  hypothesis: string;
  whyItMatters: string;
  riskiestAssumption: string;
  experimentType: string;
  audience: string;
  steps: string[];
  estimatedCost: number;
  estimatedDays: number;
  successThreshold: { description: string; metric: string; value: number };
  failureThreshold: { description: string; metric: string; value: number };
  evidenceToCollect: string[];
  doNotBuildYet: string[];
}

export function projectValidation(
  raw: z.infer<typeof validationDesign.schema>,
  limits: { budget: number | null; days: number | null },
): Projected<ProjectedValidation> {
  const report = emptyReport();

  const maxCost = limits.budget ?? 100_000;
  const maxDays = limits.days ?? 90;

  return {
    value: {
      hypothesis: raw.hypothesis.trim(),
      whyItMatters: raw.whyItMatters.trim(),
      riskiestAssumption: raw.riskiestAssumption.trim(),
      experimentType: raw.experimentType,
      audience: raw.audience.trim(),
      steps: raw.steps.map((step) => step.trim()).filter(Boolean),
      // An experiment that costs more than the workspace has is not a plan.
      // Clamping is honest here because the ceiling is a fact about the
      // owner's resources, not a judgement about the design.
      estimatedCost: clampNumber(raw.estimatedCost, { min: 0, max: maxCost }, 'estimatedCost', report),
      estimatedDays: clampNumber(raw.estimatedDays, { min: 0.5, max: maxDays }, 'estimatedDays', report),
      successThreshold: {
        description: raw.successThreshold.description.trim(),
        metric: raw.successThreshold.metric.trim(),
        value: raw.successThreshold.value,
      },
      failureThreshold: {
        description: raw.failureThreshold.description.trim(),
        metric: raw.failureThreshold.metric.trim(),
        value: raw.failureThreshold.value,
      },
      evidenceToCollect: raw.evidenceToCollect.map((entry) => entry.trim()).filter(Boolean),
      doNotBuildYet: raw.doNotBuildYet.map((entry) => entry.trim()).filter(Boolean),
    },
    report,
  };
}

function projectStanced(
  findings: ReadonlyArray<{ claim: string; signalIds: string[]; confidence: number; stance: 'for' | 'against' }>,
  suppliedIds: readonly string[],
  report: ProjectionReport,
): StancedClaim[] {
  const projected = projectClaims(findings, suppliedIds, report);

  // projectClaims preserves order and drops uncited claims, so stances are
  // re-matched by claim text rather than by index.
  const stanceByClaim = new Map(findings.map((finding) => [finding.claim.trim().slice(0, 1000), finding.stance]));

  return projected.map((claim) => ({
    ...claim,
    stance: stanceByClaim.get(claim.claim) ?? 'for',
  }));
}

/**
 * The prefix marking a block that is an earlier conclusion rather than evidence.
 *
 * Prior findings are shown to later roles as untrusted content -- they are
 * ultimately derived from fetched text, so they never become trusted prompt
 * variables. But they are not evidence either, and a claim resting only on an
 * earlier conclusion is the system agreeing with itself. Stripping these
 * citations before projection means such a claim arrives with nothing cited and
 * is dropped, which is the correct outcome.
 */
export const NON_EVIDENCE_PREFIX = 'prior:';

export function stripNonEvidenceCitations<T>(payload: T): T {
  return walk(payload) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value === null || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'signalIds' && Array.isArray(entry)) {
      result[key] = entry.filter(
        (id) => typeof id !== 'string' || !id.startsWith(NON_EVIDENCE_PREFIX),
      );
      continue;
    }
    result[key] = walk(entry);
  }
  return result;
}
