import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scenario corpora the evaluations run against.
 *
 * Each is a small, hand-written body of evidence with a stated expectation of
 * what a competent analysis should conclude. They are deliberately not all
 * flattering: four of the ten describe opportunities that should be killed, and
 * one contains an instruction aimed at the model.
 */

export interface ScenarioEvidence {
  id: string;
  title: string;
  body: string;
  signalType: string;
  evidenceClass: string;
  url: string;
  monthlyAmount?: number;
}

export interface ScenarioExpectation {
  customerMentions?: string[];
  willingnessToPay?: string[];
  spendingEvidenceAtLeast?: number;
  freeAlternativeExpected?: boolean;
  criticalUnknownMentions?: string[];
  redTeamVerdictIn?: string[];
  redTeamCategories?: string[];
  injectionExpected?: boolean;
  singleOrigin?: boolean;
}

export interface Scenario {
  key: string;
  title: string;
  thesis: string;
  note: string;
  evidence: ScenarioEvidence[];
  expect: ScenarioExpectation;
}

const DIRECTORY = 'fixtures/scenarios';

export function loadScenarios(): Scenario[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(DIRECTORY, name), 'utf8')) as Scenario);
}

/** The ids an analysis of this scenario is allowed to cite. */
export function citableIds(scenario: Scenario): string[] {
  return scenario.evidence.map((item) => item.id);
}
