import { describe, expect, it } from 'vitest';
import {
  decideDepth,
  rankByValueOfInformation,
  shouldReject,
  type CandidateState,
} from '../../src/domain/investigation/policy';
import {
  projectDemand,
  projectMarket,
  projectRedTeam,
  projectUncertainty,
  stripNonEvidenceCitations,
} from '../../src/pipeline/investigations/project';
import {
  canTransition,
  confidenceEffect,
  EXPERIMENT_STATES,
  judgeExperiment,
  type ExperimentState,
} from '../../src/domain/state/experiment-state';
import { INVESTIGATION_ROLES, ROLE_ORDER, readyRoles } from '../../src/pipeline/investigations/roles';

function candidate(overrides: Partial<CandidateState> = {}): CandidateState {
  return {
    uniqueEvidenceCount: overrides.uniqueEvidenceCount ?? 5,
    independentSourceCount: overrides.independentSourceCount ?? 3,
    preliminaryScore: overrides.preliminaryScore ?? 65,
    confidence: overrides.confidence ?? 0.5,
    hasSpendingEvidence: overrides.hasSpendingEvidence ?? true,
    completedRoles: overrides.completedRoles ?? [],
    redTeamVerdict: overrides.redTeamVerdict ?? null,
  };
}

describe('deciding how far to investigate', () => {
  it('refuses to research anything nobody has independently corroborated', () => {
    const decision = decideDepth(candidate({ independentSourceCount: 0 }));
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toContain('one party');
  });

  it('says exactly what is missing when there is too little evidence', () => {
    const decision = decideDepth(candidate({ uniqueEvidenceCount: 1, independentSourceCount: 1 }));
    expect(decision.stage).toBe('collect_more');
    expect(decision.needed).toContain('2 more unique piece(s)');
    expect(decision.needed).toContain('1 more independent source');
  });

  it('will not pay to research something scoring poorly before research', () => {
    const decision = decideDepth(candidate({ preliminaryScore: 20 }));
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toContain('does not justify paying');
  });

  it('investigates once there is enough independent evidence', () => {
    const decision = decideDepth(candidate());
    expect(decision).toMatchObject({ stage: 'investigate', proceed: true });
  });

  it('keeps the expensive red team for candidates that earned it', () => {
    const investigated = { completedRoles: ['market', 'competitors', 'demand'] };

    expect(decideDepth(candidate({ ...investigated, preliminaryScore: 50 })).proceed).toBe(false);
    expect(decideDepth(candidate({ ...investigated, preliminaryScore: 70 }))).toMatchObject({
      stage: 'red_team',
      proceed: true,
    });
  });

  it('stops entirely once the red team calls it fatal', () => {
    const decision = decideDepth(
      candidate({
        completedRoles: ['market', 'competitors', 'demand', 'red_team'],
        redTeamVerdict: 'fatal',
        preliminaryScore: 90,
      }),
    );

    // Continuing to spend on something already argued dead is the most
    // wasteful thing the system could do.
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toContain('fatal objection');
    expect(decision.needed).toContain('reopen');
  });

  it('proposes a test rather than more research once it survives', () => {
    const decision = decideDepth(
      candidate({
        completedRoles: ['market', 'competitors', 'demand', 'uncertainty', 'red_team'],
        redTeamVerdict: 'survivable',
        confidence: 0.5,
      }),
    );

    expect(decision).toMatchObject({ stage: 'propose_validation', proceed: true });
    expect(decision.reason).toContain('cheap test, not more research');
  });

  it('refuses to design a test around evidence too thin to aim it', () => {
    const decision = decideDepth(
      candidate({
        completedRoles: ['market', 'competitors', 'demand', 'uncertainty', 'red_team'],
        redTeamVerdict: 'survivable',
        confidence: 0.15,
      }),
    );
    expect(decision.stage).toBe('collect_more');
  });
});

/**
 * Acceptance test (b) at the policy level: an idea with plenty of noise, no
 * money changing hands, and a free alternative must be rejected rather than
 * ranked.
 */
describe('acceptance: killing an attractive-looking idea', () => {
  it('rejects loud complaint with no evidence of payment', () => {
    const verdict = shouldReject({
      redTeamVerdict: 'serious_but_testable',
      fatalObjectionCount: 0,
      willingnessToPay: 'absent',
      hasFreeAlternative: true,
      complaintCount: 40,
    });

    expect(verdict.reject).toBe(true);
    expect(verdict.reason).toContain('Volume of complaint is not demand');
  });

  it('does not reject complaint alone when people are actually paying', () => {
    expect(
      shouldReject({
        redTeamVerdict: 'survivable',
        fatalObjectionCount: 0,
        willingnessToPay: 'demonstrated',
        hasFreeAlternative: true,
        complaintCount: 40,
      }).reject,
    ).toBe(false);
  });

  it('rejects when the evidence actively says people will not pay', () => {
    expect(
      shouldReject({
        redTeamVerdict: 'survivable',
        fatalObjectionCount: 0,
        willingnessToPay: 'contradicted',
        hasFreeAlternative: false,
        complaintCount: 2,
      }).reject,
    ).toBe(true);
  });

  it('rejects on a single fatal objection', () => {
    expect(
      shouldReject({
        redTeamVerdict: 'fatal',
        fatalObjectionCount: 1,
        willingnessToPay: 'demonstrated',
        hasFreeAlternative: false,
        complaintCount: 0,
      }).reject,
    ).toBe(true);
  });

  it('does not reject merely because a free alternative exists', () => {
    // Plenty of paid products compete with a free option. Absence of payment
    // is what matters, not presence of an alternative.
    expect(
      shouldReject({
        redTeamVerdict: 'survivable',
        fatalObjectionCount: 0,
        willingnessToPay: 'demonstrated',
        hasFreeAlternative: true,
        complaintCount: 10,
      }).reject,
    ).toBe(false);
  });
});

describe('value of information', () => {
  const items = [
    {
      id: 'cheap-critical',
      statement: 'Will practice managers pay more than £100 a month?',
      kind: 'critical_unknown' as const,
      impact: 0.9,
      resolvability: 0.8,
      costToResolve: 0,
      daysToResolve: 2,
    },
    {
      id: 'expensive-critical',
      statement: 'What is the total addressable market?',
      kind: 'critical_unknown' as const,
      impact: 0.6,
      resolvability: 0.4,
      costToResolve: 5000,
      daysToResolve: 20,
    },
    {
      id: 'cheap-irrelevant',
      statement: 'How many competitors have a mobile app?',
      kind: 'unknown' as const,
      impact: 0.1,
      resolvability: 0.95,
      costToResolve: 0,
      daysToResolve: 0.5,
    },
    { id: 'known', statement: 'They use spreadsheets', kind: 'known_fact' as const, impact: 1, resolvability: 1, costToResolve: 0, daysToResolve: 0 },
  ];

  it('puts the cheap question that changes the decision first', () => {
    const ranked = rankByValueOfInformation(items);
    expect(ranked[0]?.id).toBe('cheap-critical');
  });

  it('ranks an easy but irrelevant question below a decisive one', () => {
    // The failure mode this prevents: researching whatever was easiest to look
    // up, and calling the result progress.
    const ranked = rankByValueOfInformation(items);
    const critical = ranked.findIndex((item) => item.id === 'cheap-critical');
    const irrelevant = ranked.findIndex((item) => item.id === 'cheap-irrelevant');
    expect(critical).toBeLessThan(irrelevant);
  });

  it('leaves out what is already known', () => {
    expect(rankByValueOfInformation(items).map((item) => item.id)).not.toContain('known');
  });

  it('explains why something ranks where it does', () => {
    const ranked = rankByValueOfInformation(items);
    expect(ranked.find((item) => item.id === 'cheap-irrelevant')?.rationale).toContain(
      'would not change what to do',
    );
    expect(ranked.find((item) => item.id === 'expensive-critical')?.rationale).toBeTruthy();
  });
});

describe('the experiment lifecycle', () => {
  const states = Object.keys(EXPERIMENT_STATES) as ExperimentState[];

  it('permits exactly the transitions it declares, and no others', () => {
    for (const from of states) {
      for (const to of states) {
        const expected = from !== to && EXPERIMENT_STATES[from].allowedNext.includes(to);
        expect(canTransition(from, to).allowed, `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('refuses to reopen a concluded experiment', () => {
    const verdict = canTransition('completed', 'running');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.remedy).toContain('Design a new experiment');
    }
  });

  it('will not accept results before the experiment has started', () => {
    expect(EXPERIMENT_STATES.proposed.acceptsResults).toBe(false);
    expect(EXPERIMENT_STATES.approved.acceptsResults).toBe(false);
    expect(EXPERIMENT_STATES.running.acceptsResults).toBe(true);
  });

  it('explains what a refused transition could do instead', () => {
    const verdict = canTransition('proposed', 'running');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.remedy).toContain('approved');
  });
});

describe('judging an experiment against thresholds set beforehand', () => {
  const thresholds = {
    successThreshold: { metric: 'paid_commitments', value: 3 },
    failureThreshold: { metric: 'problem_recognised', value: 3 },
  };

  it('validates when the agreed target is met', () => {
    const judgement = judgeExperiment({
      ...thresholds,
      results: [{ metricKey: 'paid_commitments', value: 4 }],
    });
    expect(judgement.verdict).toBe('validated');
    expect(judgement.explanation).toContain('agreed beforehand');
  });

  it('rejects when the agreed failure line is hit', () => {
    const judgement = judgeExperiment({
      ...thresholds,
      results: [{ metricKey: 'problem_recognised', value: 1 }],
    });
    expect(judgement.verdict).toBe('rejected');
  });

  it('reports a middling result as partial rather than rounding it up', () => {
    // A disappointing result must not become an encouraging one, which is the
    // entire reason the thresholds are fixed in advance.
    const judgement = judgeExperiment({
      ...thresholds,
      results: [{ metricKey: 'paid_commitments', value: 2 }],
    });
    expect(judgement.verdict).toBe('partially_validated');
    expect(judgement.explanation).toContain('short of success');
  });

  it('says nothing was learned when neither metric was measured', () => {
    const judgement = judgeExperiment({
      ...thresholds,
      results: [{ metricKey: 'something_else', value: 100 }],
    });
    expect(judgement.verdict).toBe('inconclusive');
    expect(judgement.explanation).toContain('cannot say anything');
  });
});

describe('what an experiment does to confidence', () => {
  it('moves confidence most when real customers behaved as predicted', () => {
    expect(confidenceEffect('validated').delta).toBeGreaterThan(
      confidenceEffect('partially_validated').delta,
    );
    expect(confidenceEffect('rejected').delta).toBeLessThan(0);
  });

  it('leaves confidence alone when nothing was learned', () => {
    // Nudging it upward for having run something would reward activity over
    // evidence, which is the habit this product exists to break.
    expect(confidenceEffect('inconclusive').delta).toBe(0);
  });

  it('weighs a negative result heavily', () => {
    expect(Math.abs(confidenceEffect('rejected').delta)).toBeGreaterThan(
      confidenceEffect('validated').delta,
    );
  });
});

describe('the investigation roles', () => {
  it('states a purpose and a termination condition for every role', () => {
    for (const key of ROLE_ORDER) {
      const role = INVESTIGATION_ROLES[key];
      expect(role.purpose.length, key).toBeGreaterThan(20);
      // A role that cannot say why it finished will keep spending money.
      expect(role.termination.length, key).toBeGreaterThan(20);
      expect(role.budgetCapUsd).toBeGreaterThan(0);
    }
  });

  it('reserves the most expensive model tier for the red team', () => {
    expect(INVESTIGATION_ROLES.red_team.aiRole).toBe('high_value_decision');
    expect(INVESTIGATION_ROLES.market.aiRole).toBe('research');
  });

  it('runs each role only once its dependencies are satisfied', () => {
    expect(readyRoles(new Set())).toEqual(['market']);
    expect(readyRoles(new Set(['market']))).toEqual(expect.arrayContaining(['competitors', 'demand']));
    // The red team needs the full picture before it can attack the thesis.
    expect(readyRoles(new Set(['market', 'competitors']))).not.toContain('red_team');
    expect(readyRoles(new Set(['market', 'competitors', 'demand']))).toContain('red_team');
  });

  it('tells every role to cite its evidence and refuse to invent facts', () => {
    for (const key of ROLE_ORDER) {
      const system = INVESTIGATION_ROLES[key].prompt.system;
      expect(system, key).toContain('Cite the id');
      expect(system, key).toContain('Do not introduce facts');
    }
  });

  it('tells the red team to argue in earnest rather than hedge', () => {
    const system = INVESTIGATION_ROLES.red_team.prompt.system;
    expect(system).toContain('kill this idea');
    expect(system).toContain('"fatal" is a legitimate');
  });
});

describe('projecting investigation output', () => {
  const supplied = ['evidence-1', 'evidence-2'];

  it('drops a claim whose every citation was invented', () => {
    const projected = projectMarket(
      {
        injectionAttempts: [],
        customerDescription: 'Independent restaurants',
        problemStatement: 'No-shows',
        currentAlternatives: [],
        unknowns: [],
        findings: [
          { claim: 'Owners already pay for software.', signalIds: ['evidence-1'], confidence: 0.8, stance: 'for' },
          { claim: 'Everyone in the country wants this.', signalIds: ['made-up'], confidence: 0.9, stance: 'for' },
        ],
      },
      supplied,
    );

    expect(projected.value.findings).toHaveLength(1);
    expect(projected.report.droppedClaims).toBe(1);
    expect(projected.report.hallucinatedCitations).toEqual(['made-up']);
  });

  it('refuses "demonstrated" willingness to pay when nothing cited survived', () => {
    const projected = projectDemand(
      {
        injectionAttempts: [],
        spendingEvidence: [
          { description: 'Someone pays for this', monthlyAmount: 200, currency: 'GBP', signalIds: ['invented'] },
        ],
        unpaidComplaintCount: 4,
        willingnessToPayAssessment: 'demonstrated',
        findings: [],
      },
      supplied,
    );

    // The most consequential claim in the product, so it is the one held to
    // the strictest standard: no citation, no assessment.
    expect(projected.value.willingnessToPay).toBe('insufficient_evidence');
    expect(projected.value.spendingEvidence).toHaveLength(0);
  });

  it('downgrades a fatal verdict that no cited objection supports', () => {
    const projected = projectRedTeam(
      {
        injectionAttempts: [],
        strongestObjection: 'This cannot work.',
        objections: [
          {
            category: 'poor_economics',
            argument: 'The numbers never work.',
            severity: 'fatal',
            signalIds: ['invented'],
            disconfirmingTest: null,
          },
        ],
        verdict: 'fatal',
        verdictReason: 'It will not work.',
      },
      supplied,
    );

    expect(projected.value.verdict).toBe('serious_but_testable');
    expect(projected.value.verdictDowngradedFrom).toBe('fatal');
    expect(projected.value.objections[0]?.unsupported).toBe(true);
    expect(projected.value.counterEvidenceIds).toEqual([]);
  });

  it('keeps a fatal verdict that cites real evidence, and collects the counter-evidence', () => {
    const projected = projectRedTeam(
      {
        injectionAttempts: [],
        strongestObjection: 'Nobody has ever paid for this.',
        objections: [
          {
            category: 'complaints_without_purchase',
            argument: 'Complaints everywhere, no observed spending.',
            severity: 'fatal',
            signalIds: ['evidence-1', 'evidence-2'],
            disconfirmingTest: 'Find one buyer.',
          },
        ],
        verdict: 'fatal',
        verdictReason: 'Complaint has never become spending.',
      },
      supplied,
    );

    expect(projected.value.verdict).toBe('fatal');
    expect(projected.value.verdictDowngradedFrom).toBeNull();
    expect(projected.value.counterEvidenceIds).toEqual(['evidence-1', 'evidence-2']);
  });

  it('records an uncited "known fact" as an assumption', () => {
    const projected = projectUncertainty(
      {
        injectionAttempts: [],
        items: [
          {
            kind: 'known_fact',
            statement: 'Restaurants will pay for this',
            impact: 0.9,
            resolvability: 0.5,
            estimatedCost: null,
            estimatedDays: null,
            signalIds: [],
          },
        ],
      },
      supplied,
    );

    expect(projected.value.items[0]?.kind).toBe('assumption');
    expect(projected.report.droppedValues[0]).toContain('assumption');
  });

  it('strips citations of earlier conclusions before anything is projected', () => {
    const cleaned = stripNonEvidenceCitations({
      findings: [{ claim: 'A claim', signalIds: ['prior:investigation.market', 'evidence-1'], confidence: 0.5 }],
    });

    // An earlier conclusion is not evidence; a claim resting only on one is
    // the system agreeing with itself, so it arrives uncited and is dropped.
    expect(cleaned.findings[0]?.signalIds).toEqual(['evidence-1']);
  });
});
