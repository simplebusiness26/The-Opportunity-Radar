import type { AiRole } from '../../domain/budget/index';
import type { PromptTemplate } from '../prompts/assembler';
import { INVESTIGATION_SCHEMAS, type InvestigationRoleKey } from '../schemas/investigation';

/**
 * The investigation roles.
 *
 * Each has one responsibility, one output schema and one stated condition under
 * which it stops. That last part is what separates this from calling something
 * an agent and hoping: a role that cannot say why it finished will keep
 * spending money, and a role whose output is not validated cannot be trusted
 * with the evidence base.
 *
 * They run in a fixed order under deterministic orchestration. Nothing here
 * decides what to do next; the pipeline does, from the thresholds.
 */

export interface RoleDefinition {
  key: InvestigationRoleKey;
  name: string;
  /** What this role is for, in one sentence. */
  purpose: string;
  aiRole: AiRole;
  schema: (typeof INVESTIGATION_SCHEMAS)[InvestigationRoleKey];
  prompt: PromptTemplate;
  /** Stated plainly, and recorded on the run. */
  termination: string;
  /** Rough ceiling on one run, in US dollars. */
  budgetCapUsd: number;
  /** Roles that must have run first. */
  dependsOn: InvestigationRoleKey[];
}

const SHARED_CONTEXT = `
You are given evidence Radar has collected. Each item has an id.

Rules that apply to every answer:
- Cite the id of every item you rely on. A claim with no citation is discarded.
- Do not introduce facts that are not in the evidence. If something is not
  there, say it is unknown rather than supplying a plausible answer.
- Distinguish what the evidence shows from what it merely suggests.
`.trim();

export const INVESTIGATION_ROLES: Record<InvestigationRoleKey, RoleDefinition> = {
  market: {
    key: 'market',
    name: 'Market investigator',
    purpose: 'Establishes who has the problem and how they currently cope with it.',
    aiRole: 'research',
    schema: INVESTIGATION_SCHEMAS.market,
    budgetCapUsd: 0.5,
    dependsOn: [],
    termination:
      'Stops once the customer and the problem are stated, or once the evidence is too thin to state either.',
    prompt: {
      key: 'investigation.market',
      version: 'v1',
      system: `${SHARED_CONTEXT}

Describe the customer who has this problem and how they handle it today.
Be specific about who: "independent restaurants with 20 to 60 covers" is useful,
"businesses" is not. If the evidence does not identify a specific customer, say
so in unknowns rather than generalising.`,
      user: 'Opportunity: {{title}}\n\nThesis: {{thesis}}\n\nExamine the evidence below.',
    },
  },

  competitors: {
    key: 'competitors',
    name: 'Competitor analyst',
    purpose: 'Maps what already exists, including free alternatives.',
    aiRole: 'research',
    schema: INVESTIGATION_SCHEMAS.competitors,
    budgetCapUsd: 0.5,
    dependsOn: ['market'],
    termination: 'Stops once existing solutions and the gap between them are described.',
    prompt: {
      key: 'investigation.competitors',
      version: 'v1',
      system: `${SHARED_CONTEXT}

List what already solves this problem, and what users say is wrong with each.

Pay particular attention to free alternatives, including doing it by hand in a
spreadsheet. "People already do this for nothing" is the most common reason a
paid product fails, and it is routinely overlooked because it does not look
like a competitor.`,
      user: 'Opportunity: {{title}}\n\nCustomer: {{customer}}\n\nExamine the evidence below.',
    },
  },

  demand: {
    key: 'demand',
    name: 'Demand analyst',
    purpose: 'Looks specifically for evidence that money already moves.',
    aiRole: 'research',
    schema: INVESTIGATION_SCHEMAS.demand,
    budgetCapUsd: 0.5,
    dependsOn: ['market'],
    termination:
      'Stops once willingness to pay is assessed, including concluding that the evidence does not support an assessment.',
    prompt: {
      key: 'investigation.demand',
      version: 'v1',
      system: `${SHARED_CONTEXT}

Find evidence that money is already being spent on this problem.

Hold two things firmly apart:
- Someone paying, or having paid, is evidence of demand.
- Someone complaining, agreeing it is a problem, or saying they would pay is
  not. Stated intent is famously unreliable.

If you find complaints but no spending, say so: set willingnessToPay to
"absent" and record the complaint count. That is a real and important finding,
not a failure to find one.`,
      user: 'Opportunity: {{title}}\n\nProblem: {{problem}}\n\nExamine the evidence below.',
    },
  },

  red_team: {
    key: 'red_team',
    name: 'Red team',
    purpose: 'Argues the strongest case against, in earnest.',
    // The most expensive model tier: this is the judgement that most often
    // prevents wasted months, so it is worth paying for.
    aiRole: 'high_value_decision',
    schema: INVESTIGATION_SCHEMAS.red_team,
    budgetCapUsd: 1,
    dependsOn: ['market', 'competitors', 'demand'],
    termination: 'Stops once a verdict is reached with its reasoning stated.',
    prompt: {
      key: 'investigation.red_team',
      version: 'v1',
      system: `${SHARED_CONTEXT}

Your task is to kill this idea if it can be killed.

Argue the strongest case against it that the evidence supports. Do not
manufacture objections the evidence does not support, and do not soften ones it
does. An idea that survives a genuine attempt to destroy it is worth pursuing;
an idea that was never attacked has not been tested at all.

Weigh especially:
- complaints that never became purchases
- free or manual alternatives that are good enough
- how customers would actually be reached, and at what cost
- whether anyone has tried this before and failed

For each objection, state what would settle it. An objection nobody can test is
an opinion.

Reach a verdict. "fatal" is a legitimate and useful answer.`,
      user:
        'Opportunity: {{title}}\n\nThesis: {{thesis}}\n\nWhat earlier stages found:\n{{priorFindings}}\n\nExamine the evidence below.',
    },
  },

  uncertainty: {
    key: 'uncertainty',
    name: 'Uncertainty analyst',
    purpose: 'Separates what is known from what is assumed and what is unknown.',
    aiRole: 'reasoning',
    schema: INVESTIGATION_SCHEMAS.uncertainty,
    budgetCapUsd: 0.5,
    dependsOn: ['market', 'demand'],
    termination: 'Stops once the critical unknowns are identified and costed.',
    prompt: {
      key: 'investigation.uncertainty',
      version: 'v1',
      system: `${SHARED_CONTEXT}

Separate what the evidence establishes from what is being assumed and what is
simply unknown.

Mark an unknown as critical when the decision would change depending on the
answer. Most unknowns are not critical, and treating them all as equal is how
research budgets get spent on the questions that were easiest to ask.

For each, estimate what answering it would cost and how long it would take.`,
      user: 'Opportunity: {{title}}\n\nThesis: {{thesis}}\n\nExamine the evidence below.',
    },
  },

  validation: {
    key: 'validation',
    name: 'Validation designer',
    purpose: 'Designs the cheapest credible test of the riskiest assumption.',
    aiRole: 'reasoning',
    schema: INVESTIGATION_SCHEMAS.validation,
    budgetCapUsd: 0.5,
    dependsOn: ['uncertainty'],
    termination: 'Stops once one experiment with stated thresholds is designed.',
    prompt: {
      key: 'investigation.validation',
      version: 'v1',
      system: `${SHARED_CONTEXT}

Design one experiment that would resolve the riskiest assumption for the least
money and time.

Requirements:
- Test the assumption that would most change the decision, not the one easiest
  to test.
- State what result counts as success and what counts as failure, before it
  runs. Deciding afterwards is how a disappointing result becomes an
  encouraging one.
- Prefer talking to people over building anything.
- List what must not be built until this resolves. Preventing premature
  building matters as much as finding the opportunity.`,
      user:
        'Opportunity: {{title}}\n\nRiskiest assumptions:\n{{assumptions}}\n\nAvailable budget: {{budget}}\nAvailable days: {{days}}',
    },
  },
};

export const ROLE_ORDER: InvestigationRoleKey[] = [
  'market',
  'competitors',
  'demand',
  'uncertainty',
  'red_team',
  'validation',
];

/** Roles whose dependencies have all completed. */
export function readyRoles(completed: Set<InvestigationRoleKey>): InvestigationRoleKey[] {
  return ROLE_ORDER.filter(
    (key) =>
      !completed.has(key) &&
      INVESTIGATION_ROLES[key].dependsOn.every((dependency) => completed.has(dependency)),
  );
}
