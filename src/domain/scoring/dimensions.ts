import { MONETARY_SIGNAL_TYPES } from '../taxonomy/signal-types';
import { OPPORTUNITY_TYPES } from '../taxonomy/opportunity-types';
import type { DimensionDefinition, DimensionResult, ScoringInput } from './types';
import { clamp, invert, linear, logarithmic, median, saturating } from './normalise';

/**
 * The scored dimensions.
 *
 * Each one is a pure function of the frozen input, so every number on an
 * opportunity page can be reproduced and argued with. Two rules matter more
 * than the individual formulas:
 *
 *   Absent evidence is never scored as zero. A dimension with nothing behind it
 *   reports `insufficient_evidence`, drops out of its composite, and lowers
 *   confidence -- because "we have not looked" and "we looked and it is bad"
 *   are completely different statements.
 *
 *   No dimension in `attractiveness` may read a certainty measure. How good the
 *   opportunity is and how sure we are about it are computed separately, and a
 *   test enforces that separation so it cannot quietly return.
 */

const insufficient = (explanation: string, factors: DimensionResult['factors'] = []): DimensionResult => ({
  status: 'insufficient_evidence',
  raw: null,
  normalised: null,
  factors,
  explanation,
});

const ok = (
  raw: number,
  normalised: number,
  explanation: string,
  factors: DimensionResult['factors'] = [],
): DimensionResult => ({
  status: 'ok',
  raw,
  normalised: clamp(normalised),
  factors,
  explanation,
});

function strengthOf(input: ScoringInput, types: readonly string[]): number {
  let total = 0;
  for (const [type, strength] of Object.entries(input.evidence.strengthByType)) {
    if (types.includes(type)) total += strength ?? 0;
  }
  return total;
}

export const DIMENSIONS: DimensionDefinition[] = [
  // ---------------------------------------------------------------- attractiveness
  {
    key: 'problem_severity',
    label: 'Problem severity',
    composite: 'attractiveness',
    description: 'How much the problem actually hurts the people who have it.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const pain = strengthOf(input, ['pain', 'workaround', 'competitor_weakness']);
      if (pain === 0) return insufficient('No evidence yet of how much this problem hurts.');
      return ok(
        pain,
        saturating(pain, 1.5),
        `Pain, workaround and competitor-weakness evidence totalling ${pain.toFixed(2)} in effective strength.`,
        [{ key: 'painStrength', label: 'Pain evidence strength', rawValue: Number(pain.toFixed(2)) }],
      );
    },
  },
  {
    key: 'problem_frequency',
    label: 'Problem frequency',
    composite: 'attractiveness',
    description: 'How often the problem recurs for a given customer.',
    direction: 'higher_is_better',
    defaultWeight: 0.8,
    compute: (input) => {
      const recurring = strengthOf(input, ['labour', 'workaround']);
      const mentions = input.evidence.uniqueEvidence;
      if (recurring === 0 && mentions < 3) {
        return insufficient('Not enough distinct observations to tell whether this recurs.');
      }
      const raw = recurring + mentions * 0.1;
      return ok(
        raw,
        saturating(raw, 2),
        recurring > 0
          ? 'People are repeatedly paid, or repeatedly work around this, which indicates it recurs.'
          : `Inferred from ${mentions} distinct observations; no direct evidence of recurrence yet.`,
      );
    },
  },
  {
    key: 'willingness_to_pay',
    label: 'Willingness to pay',
    composite: 'attractiveness',
    description: 'Whether anyone actually pays to solve this today.',
    direction: 'higher_is_better',
    defaultWeight: 1.4,
    compute: (input) => {
      const monetary = strengthOf(input, MONETARY_SIGNAL_TYPES);
      const spends = input.market.observedMonthlySpend;

      // The single most important gap in the model. Complaints are abundant and
      // cheap; evidence that money changes hands is neither. When it is absent
      // this must read as unknown, never as zero, or a loud unpaid problem
      // would score the same as one nobody has checked.
      if (monetary === 0 && spends.length === 0) {
        return insufficient(
          'No evidence anyone pays for this today. That is a gap in what we know, not proof that nobody would.',
        );
      }

      const typical = median(spends);
      const raw = monetary + (typical ? logarithmic(typical, 10, 1000) : 0);
      return ok(
        raw,
        saturating(raw, 1.2),
        typical
          ? `Observed spend of about ${typical} per month across ${spends.length} data points.`
          : 'Spending or hiring evidence exists, but no specific prices have been recorded.',
        [
          { key: 'observedSpendCount', label: 'Price points observed', rawValue: spends.length },
          { key: 'medianMonthlySpend', label: 'Median monthly spend', rawValue: typical },
        ],
      );
    },
  },
  {
    key: 'existing_spend',
    label: 'Existing spend',
    composite: 'attractiveness',
    description: 'The size of the budget already flowing to this problem.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const spends = input.market.observedMonthlySpend;
      if (spends.length === 0) return insufficient('No prices have been observed yet.');
      const typical = median(spends) ?? 0;
      return ok(
        typical,
        logarithmic(typical, 10, 2000),
        `Median observed spend is ${typical} per month.`,
      );
    },
  },
  {
    key: 'evidence_strength',
    label: 'Evidence strength',
    composite: 'attractiveness',
    description: 'How strong the underlying evidence is, after decay.',
    direction: 'higher_is_better',
    defaultWeight: 1.1,
    compute: (input) => {
      const total = Object.values(input.evidence.strengthByType).reduce(
        (sum, value) => sum + (value ?? 0),
        0,
      );
      if (input.evidence.uniqueEvidence === 0) return insufficient('There is no evidence yet.');
      return ok(
        total,
        saturating(total, 3),
        `${input.evidence.uniqueEvidence} pieces of unique evidence with combined effective strength ${total.toFixed(2)}.`,
      );
    },
  },
  {
    key: 'competition_gap',
    label: 'Competition gap',
    composite: 'attractiveness',
    description: 'Whether existing solutions leave real room.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const { competitorCount, freeAlternativeCount, competitorWeaknessCount } = input.market;
      if (competitorCount === null) {
        return insufficient('Competitors have not been mapped yet.');
      }

      // A good free alternative is the hardest competitor to beat, and the one
      // most often ignored by opportunity scoring.
      const free = freeAlternativeCount ?? 0;
      const crowding = saturating(competitorCount + free * 2, 6);
      const weakness = saturating(competitorWeaknessCount, 4);
      const raw = clamp(invert(crowding) * 0.6 + weakness * 0.4);

      return ok(
        raw,
        raw,
        free > 0
          ? `${competitorCount} paid alternatives and ${free} credible free ones, which makes charging materially harder.`
          : `${competitorCount} alternatives, with ${competitorWeaknessCount} recorded complaints about them.`,
        [
          { key: 'competitorCount', label: 'Competitors', rawValue: competitorCount },
          { key: 'freeAlternatives', label: 'Free alternatives', rawValue: free },
        ],
      );
    },
  },
  {
    key: 'market_momentum',
    label: 'Market momentum',
    composite: 'attractiveness',
    description: 'Whether interest and adoption are moving.',
    direction: 'higher_is_better',
    defaultWeight: 0.6,
    compute: (input) => {
      const momentum = input.market.momentum30d;
      if (momentum === null) return insufficient('Not enough history to measure movement.');
      return ok(
        momentum,
        linear(momentum, -0.2, 1),
        momentum > 0.1
          ? `Evidence is accumulating ${Math.round(momentum * 100)}% faster than the previous period.`
          : 'Interest is flat or falling.',
      );
    },
  },
  {
    key: 'customer_acquisition_difficulty',
    label: 'Customer acquisition difficulty',
    composite: 'attractiveness',
    description: 'How hard these customers are to reach at all.',
    direction: 'lower_is_better',
    defaultWeight: 0.9,
    compute: (input) => {
      const distributionEvidence = strengthOf(input, ['distribution']);
      const needsNewAudience = OPPORTUNITY_TYPES[input.opportunityType].requiresNewAudience;
      const raw = clamp(0.5 + (needsNewAudience ? 0.25 : -0.2) - saturating(distributionEvidence, 1) * 0.4);
      return ok(
        raw,
        invert(raw),
        needsNewAudience
          ? 'This needs an audience we do not already have.'
          : 'This can be sold to people we can already reach.',
      );
    },
  },

  // ---------------------------------------------------------------------- fit
  {
    key: 'founder_fit',
    label: 'Domain fit',
    composite: 'fit',
    description: 'Whether we understand this domain.',
    direction: 'higher_is_better',
    defaultWeight: 1.2,
    compute: (input) => {
      if (input.internal.hasDomainExperience === null) {
        return insufficient('Our experience in this domain has not been recorded.');
      }
      const { successes, failures } = input.internal.priorRelatedOutcomes;
      const track = successes + failures > 0 ? successes / (successes + failures) : 0.5;
      const raw = clamp((input.internal.hasDomainExperience ? 0.7 : 0.25) * 0.6 + track * 0.4);
      return ok(
        raw,
        raw,
        input.internal.hasDomainExperience
          ? `We have worked in this domain before, with ${successes} good and ${failures} poor outcomes.`
          : 'This is a domain we have not worked in.',
      );
    },
  },
  {
    key: 'distribution_access',
    label: 'Distribution access',
    composite: 'fit',
    description: 'Whether we can already reach these customers.',
    direction: 'higher_is_better',
    defaultWeight: 1.2,
    compute: (input) => {
      if (input.internal.hasDistribution === null) {
        return insufficient('We have not recorded whether we can reach these customers.');
      }
      return ok(
        input.internal.hasDistribution ? 1 : 0,
        input.internal.hasDistribution ? 0.9 : 0.2,
        input.internal.hasDistribution
          ? 'We already have a way to reach this audience.'
          : 'We would have to build an audience from nothing, which is usually the slowest part.',
      );
    },
  },
  {
    key: 'capital_efficiency',
    label: 'Capital efficiency',
    composite: 'fit',
    description: 'Whether this fits the money actually available.',
    direction: 'higher_is_better',
    defaultWeight: 0.9,
    compute: (input) => {
      const { estimatedValidationCost, availableBudget } = input.economics;
      if (estimatedValidationCost === null || availableBudget === null) {
        return insufficient('Validation cost or available budget has not been set.');
      }
      if (availableBudget <= 0) {
        return ok(0, 0, 'There is no budget available, so nothing can be spent on this yet.');
      }
      const ratio = estimatedValidationCost / availableBudget;
      return ok(
        ratio,
        invert(linear(ratio, 0, 1)),
        `Validating this costs about ${Math.round(ratio * 100)}% of the available budget.`,
      );
    },
  },
  {
    key: 'time_fit',
    label: 'Time fit',
    composite: 'fit',
    description: 'Whether this fits the time actually available.',
    direction: 'higher_is_better',
    defaultWeight: 0.9,
    compute: (input) => {
      const { estimatedMvpDaysLeveraged, availableDays } = input.economics;
      if (!estimatedMvpDaysLeveraged || availableDays === null) {
        return insufficient('Build estimate or available time has not been set.');
      }
      const [, worst] = estimatedMvpDaysLeveraged;
      if (availableDays <= 0) return ok(0, 0, 'There is no capacity available at the moment.');
      return ok(
        worst / availableDays,
        invert(linear(worst / availableDays, 0.3, 2)),
        `Up to ${worst} days of work against ${availableDays} available.`,
      );
    },
  },

  // ------------------------------------------------------------------ leverage
  {
    key: 'build_leverage',
    label: 'Build leverage',
    composite: 'leverage',
    description: 'How much of this we have already built.',
    direction: 'higher_is_better',
    defaultWeight: 1.5,
    compute: (input) => {
      const coverage = input.internal.capabilityCoverage;
      if (coverage === null || input.internal.requiredCapabilityCount === 0) {
        return insufficient('The capabilities this needs have not been worked out yet.');
      }
      return ok(
        coverage,
        coverage,
        `We already have ${Math.round(coverage * 100)}% of what this needs; ${input.internal.missingCapabilityCount} capabilities are missing.`,
        [
          { key: 'required', label: 'Capabilities required', rawValue: input.internal.requiredCapabilityCount },
          { key: 'missing', label: 'Capabilities missing', rawValue: input.internal.missingCapabilityCount },
        ],
      );
    },
  },
  {
    key: 'asset_reuse',
    label: 'Asset reuse',
    composite: 'leverage',
    description: 'How much existing work can be reused directly.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const assets = input.internal.reusableAssetCount;
      if (assets === 0 && input.internal.requiredCapabilityCount === 0) {
        return insufficient('We have not yet worked out what could be reused.');
      }
      return ok(
        assets,
        saturating(assets, 3),
        assets > 0
          ? `${assets} existing assets could be reused here.`
          : 'Nothing we already own applies directly to this.',
      );
    },
  },
  {
    key: 'mvp_speed',
    label: 'MVP speed',
    composite: 'leverage',
    description: 'How quickly something usable could exist.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const leveraged = input.economics.estimatedMvpDaysLeveraged;
      if (!leveraged) return insufficient('No build estimate has been made yet.');
      const [best, worst] = leveraged;
      const midpoint = (best + worst) / 2;
      return ok(
        midpoint,
        invert(logarithmic(midpoint, 1, 90)),
        `Roughly ${best} to ${worst} days using what we already have.`,
      );
    },
  },

  // -------------------------------------------------------------------- timing
  {
    key: 'technology_timing',
    label: 'Technology timing',
    composite: 'timing',
    description: 'Whether a technical change makes this newly possible.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const unlock = input.timing.technologyUnlockStrength + strengthOf(input, ['cost_collapse', 'infrastructure']);
      if (unlock === 0) {
        return insufficient('No evidence that anything technical has changed to make this newly possible.');
      }
      return ok(unlock, saturating(unlock, 1), 'A technical change has made this more feasible than before.');
    },
  },
  {
    key: 'regulatory_timing',
    label: 'Regulatory timing',
    composite: 'timing',
    description: 'Whether a rule change forces or blocks action.',
    direction: 'higher_is_better',
    defaultWeight: 0.8,
    compute: (input) => {
      const regulatory = strengthOf(input, ['regulation']);
      const deadline = input.timing.regulatoryDeadlineDays;
      if (regulatory === 0 && deadline === null) {
        return insufficient('No regulatory driver has been identified.');
      }
      // A near deadline is the strongest buying trigger there is.
      const urgency = deadline === null ? 0 : invert(linear(deadline, 0, 540));
      const raw = clamp(saturating(regulatory, 1) * 0.6 + urgency * 0.4);
      return ok(
        raw,
        raw,
        deadline !== null
          ? `A regulatory deadline is about ${deadline} days away.`
          : 'A regulatory change is relevant here, with no specific deadline recorded.',
      );
    },
  },
  {
    key: 'competitive_urgency',
    label: 'Competitive urgency',
    composite: 'timing',
    description: 'Whether waiting costs us the position.',
    direction: 'higher_is_better',
    defaultWeight: 0.7,
    compute: (input) => {
      if (input.timing.competitorMoving === null) {
        return insufficient('We have not checked whether anyone else is moving on this.');
      }
      return ok(
        input.timing.competitorMoving ? 1 : 0,
        input.timing.competitorMoving ? 0.85 : 0.35,
        input.timing.competitorMoving
          ? 'Someone else is visibly moving on this problem.'
          : 'Nobody appears to be moving, so there is no particular pressure to act this week.',
      );
    },
  },

  // ----------------------------------------------------- validation efficiency
  {
    key: 'validation_speed',
    label: 'Validation speed',
    composite: 'validation_efficiency',
    description: 'How quickly the main uncertainty could be settled.',
    direction: 'higher_is_better',
    defaultWeight: 1.2,
    compute: (input) => {
      const days = input.economics.estimatedValidationDays;
      if (days === null) return insufficient('No validation experiment has been designed yet.');
      return ok(days, invert(logarithmic(days, 1, 30)), `The experiment would take about ${days} days.`);
    },
  },
  {
    key: 'validation_cost',
    label: 'Validation cost',
    composite: 'validation_efficiency',
    description: 'What settling the main uncertainty would cost.',
    direction: 'lower_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const cost = input.economics.estimatedValidationCost;
      if (cost === null) return insufficient('No validation experiment has been designed yet.');
      return ok(cost, invert(logarithmic(Math.max(cost, 1), 1, 2000)), `About ${cost} to run the experiment.`);
    },
  },

  {
    key: 'real_world_result',
    label: 'Result against real people',
    composite: 'validation_efficiency',
    description: 'What happened when the thesis was tested on actual customers.',
    direction: 'higher_is_better',
    // Weighted well above the desk-research dimensions on purpose: one
    // concluded experiment is worth more than any amount of reading, and the
    // arithmetic should say so rather than the documentation.
    defaultWeight: 2.5,
    compute: (input) => {
      const validation = input.validation;
      if (validation.concludedExperiments === 0) {
        return insufficient('No experiment has produced a result, so nothing has been tested.');
      }

      // A rejection dominates. If real customers did not behave as predicted,
      // an earlier partial success does not offset it.
      if (validation.rejectedCount > 0) {
        return ok(
          -validation.rejectedCount,
          0,
          `${validation.rejectedCount} experiment(s) came back negative against real people, which is the strongest evidence available.`,
        );
      }

      const supported = validation.validatedCount + validation.partiallyValidatedCount * 0.5;
      if (supported === 0) {
        return ok(
          0,
          0.3,
          `${validation.inconclusiveCount} experiment(s) were inconclusive, so nothing was established either way.`,
        );
      }

      return ok(
        supported,
        Math.min(1, 0.6 + supported * 0.2),
        `${validation.validatedCount} experiment(s) supported the thesis against real people` +
          (validation.partiallyValidatedCount > 0
            ? `, and ${validation.partiallyValidatedCount} partly did.`
            : '.'),
      );
    },
  },

  // -------------------------------------------------------- strategic value
  {
    key: 'strategic_leverage',
    label: 'Strategic leverage',
    composite: 'strategic_value',
    description: 'What we would still own if this particular thesis failed.',
    direction: 'higher_is_better',
    defaultWeight: 1,
    compute: (input) => {
      const type = OPPORTUNITY_TYPES[input.opportunityType];
      // Building a capability leaves something behind whatever happens; chasing
      // a one-off does not.
      const base = type.category === 'acquire' ? 0.8 : type.category === 'leverage' ? 0.7 : 0.45;
      const assets = saturating(input.internal.reusableAssetCount, 4) * 0.2;
      return ok(
        base + assets,
        clamp(base + assets),
        `Pursuing this creates reusable capability regardless of whether the thesis holds (${type.label}).`,
      );
    },
  },
  {
    key: 'learning_value',
    label: 'Learning value',
    composite: 'strategic_value',
    description: 'How much this would teach us, independent of the result.',
    direction: 'higher_is_better',
    defaultWeight: 0.8,
    compute: (input) => {
      const unknowns = input.uncertainty.criticalUnknownCount;
      if (unknowns === 0 && input.uncertainty.assumptionCount === 0) {
        return insufficient('The open questions have not been written down yet.');
      }
      const raw = saturating(unknowns * 1.5 + input.uncertainty.assumptionCount * 0.5, 4);
      return ok(
        raw,
        raw,
        `${unknowns} critical unknowns would be settled by pursuing this, which is worth something on its own.`,
      );
    },
  },

  // ------------------------------------------------------------ execution risk
  {
    key: 'execution_risk',
    label: 'Execution risk',
    composite: 'execution_risk',
    description: 'How likely we are to struggle with delivery.',
    direction: 'lower_is_better',
    defaultWeight: 1.2,
    compute: (input) => {
      const missing = input.internal.missingCapabilityCount;
      const required = input.internal.requiredCapabilityCount;
      if (required === 0) return insufficient('What this needs has not been worked out yet.');

      const gap = missing / required;
      const { successes, failures } = input.internal.priorRelatedOutcomes;
      const historyPenalty = successes + failures > 0 ? failures / (successes + failures) : 0.3;
      const raw = clamp(gap * 0.6 + historyPenalty * 0.4);

      return ok(
        raw,
        invert(raw),
        `${missing} of ${required} required capabilities are missing${
          failures > 0 ? `, and similar work has failed ${failures} times before` : ''
        }.`,
      );
    },
  },
  {
    key: 'defensibility',
    label: 'Defensibility',
    composite: 'execution_risk',
    description: 'Whether we could keep this if it worked.',
    direction: 'higher_is_better',
    defaultWeight: 0.8,
    compute: (input) => {
      const coverage = input.internal.capabilityCoverage;
      const assets = input.internal.reusableAssetCount;
      if (coverage === null) return insufficient('Not assessable until required capabilities are known.');
      const raw = clamp(coverage * 0.5 + saturating(assets, 3) * 0.3 + (input.internal.hasDistribution ? 0.2 : 0));
      return ok(
        raw,
        raw,
        raw > 0.6
          ? 'Existing capability and distribution would make this hard for a newcomer to copy quickly.'
          : 'There is little here that would stop someone else doing the same thing.',
      );
    },
  },
];

export const DIMENSIONS_BY_KEY = new Map(DIMENSIONS.map((dimension) => [dimension.key, dimension]));

export const DIMENSION_KEYS = DIMENSIONS.map((dimension) => dimension.key);
