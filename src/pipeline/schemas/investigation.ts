import { z } from 'zod';
import { baseOutput, citedClaim, defineSchema } from './base';

/**
 * What each investigation role is required to return.
 *
 * Every schema demands citations rather than assertions. A finding that cannot
 * name the evidence it came from is dropped by the projector, which is what
 * keeps the evidence base free of claims the model simply produced.
 */

const stancedFinding = citedClaim.extend({
  /** Whether this supports the thesis or argues against it. */
  stance: z.enum(['for', 'against']),
});

export const marketFindings = defineSchema(
  'investigation.market',
  'v1',
  baseOutput.extend({
    customerDescription: z.string().max(500),
    problemStatement: z.string().max(1000),
    /** How the problem is currently handled, however badly. */
    currentAlternatives: z.array(z.string().max(300)).max(10).default([]),
    findings: z.array(stancedFinding).max(20).default([]),
    /** What the model could not determine from what it was given. */
    unknowns: z.array(z.string().max(300)).max(10).default([]),
  }),
);

export const competitorFindings = defineSchema(
  'investigation.competitors',
  'v1',
  baseOutput.extend({
    competitors: z
      .array(
        z.object({
          name: z.string().max(200),
          /** What users say is wrong with it, cited. */
          weaknesses: z.array(z.string().max(300)).max(8).default([]),
          pricingObserved: z.string().max(200).nullable().default(null),
          signalIds: z.array(z.string()).max(20).default([]),
        }),
      )
      .max(15)
      .default([]),
    /** Free alternatives are the most common reason a paid product fails. */
    freeAlternatives: z.array(z.string().max(200)).max(10).default([]),
    gap: z.string().max(1000),
    findings: z.array(stancedFinding).max(20).default([]),
  }),
);

export const demandFindings = defineSchema(
  'investigation.demand',
  'v1',
  baseOutput.extend({
    /**
     * Evidence that money already moves. Deliberately separate from evidence
     * that people are annoyed: the two are constantly confused, and only one of
     * them predicts a business.
     */
    spendingEvidence: z
      .array(
        z.object({
          description: z.string().max(400),
          monthlyAmount: z.number().min(0).max(10_000_000).nullable().default(null),
          currency: z.string().max(3).nullable().default(null),
          signalIds: z.array(z.string()).max(10).default([]),
        }),
      )
      .max(20)
      .default([]),
    /** Complaint volume without any observed spending. */
    unpaidComplaintCount: z.number().int().min(0).max(10_000).default(0),
    willingnessToPayAssessment: z.enum([
      'demonstrated',
      'stated_only',
      'absent',
      'contradicted',
      'insufficient_evidence',
    ]),
    findings: z.array(stancedFinding).max(20).default([]),
  }),
);

export const redTeamFindings = defineSchema(
  'investigation.red_team',
  'v1',
  baseOutput.extend({
    /**
     * The strongest case against, argued in earnest. The role exists to kill
     * the thesis if it can be killed, and a red team that keeps finding the
     * idea sound is not doing its job.
     */
    strongestObjection: z.string().max(1000),
    objections: z
      .array(
        z.object({
          category: z.enum([
            'no_willingness_to_pay',
            'declining_interest',
            'dominant_competitor',
            'free_substitute',
            'poor_economics',
            'regulatory_barrier',
            'technical_barrier',
            'acquisition_difficulty',
            'switching_cost',
            'low_urgency',
            'prior_failures',
            'hidden_complexity',
            'platform_dependency',
            'saturation',
            'complaints_without_purchase',
          ]),
          argument: z.string().max(800),
          severity: z.enum(['fatal', 'serious', 'manageable']),
          signalIds: z.array(z.string()).max(10).default([]),
          /** What would settle whether this objection holds. */
          disconfirmingTest: z.string().max(400).nullable().default(null),
        }),
      )
      .max(15)
      .default([]),
    /** Whether the objections, taken together, should stop this. */
    verdict: z.enum(['fatal', 'serious_but_testable', 'survivable', 'no_material_objection']),
    verdictReason: z.string().max(1000),
  }),
);

export const uncertaintyFindings = defineSchema(
  'investigation.uncertainty',
  'v1',
  baseOutput.extend({
    items: z
      .array(
        z.object({
          kind: z.enum(['known_fact', 'assumption', 'unknown', 'critical_unknown', 'evidence_gap']),
          statement: z.string().max(500),
          /** How much the answer would change the decision. */
          impact: z.number().min(0).max(1).default(0.5),
          resolvability: z.number().min(0).max(1).default(0.5),
          estimatedCost: z.number().min(0).max(100_000).nullable().default(null),
          estimatedDays: z.number().min(0).max(365).nullable().default(null),
          signalIds: z.array(z.string()).max(10).default([]),
        }),
      )
      .max(25)
      .default([]),
  }),
);

export const validationDesign = defineSchema(
  'investigation.validation',
  'v1',
  baseOutput.extend({
    hypothesis: z.string().max(600),
    whyItMatters: z.string().max(600),
    riskiestAssumption: z.string().max(500),
    experimentType: z.enum([
      'customer_interview',
      'landing_page',
      'concierge',
      'fake_door',
      'pre_sale',
      'outbound_outreach',
      'prototype_demo',
      'pricing_test',
      'desk_research',
    ]),
    audience: z.string().max(400),
    steps: z.array(z.string().max(400)).min(1).max(12),
    estimatedCost: z.number().min(0).max(100_000),
    estimatedDays: z.number().min(0.5).max(90),
    successThreshold: z.object({ description: z.string().max(400), metric: z.string().max(120), value: z.number() }),
    failureThreshold: z.object({ description: z.string().max(400), metric: z.string().max(120), value: z.number() }),
    evidenceToCollect: z.array(z.string().max(300)).max(10).default([]),
    /**
     * What must not be built until this resolves. Preventing premature
     * building is as much of the product's job as identifying opportunities.
     */
    doNotBuildYet: z.array(z.string().max(300)).max(12).default([]),
  }),
);

export const INVESTIGATION_SCHEMAS = {
  market: marketFindings,
  competitors: competitorFindings,
  demand: demandFindings,
  red_team: redTeamFindings,
  uncertainty: uncertaintyFindings,
  validation: validationDesign,
} as const;

export type InvestigationRoleKey = keyof typeof INVESTIGATION_SCHEMAS;
