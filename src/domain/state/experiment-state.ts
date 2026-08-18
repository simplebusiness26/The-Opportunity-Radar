/**
 * The experiment lifecycle.
 *
 * Modelled explicitly, like the opportunity lifecycle, because the interesting
 * transitions are the ones that must not happen: an experiment cannot report a
 * result before it ran, and it cannot be quietly reopened once concluded.
 */

export type ExperimentState =
  | 'proposed'
  | 'approved'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'abandoned';

export type ExperimentVerdict =
  | 'validated'
  | 'partially_validated'
  | 'inconclusive'
  | 'rejected';

export interface ExperimentStateDefinition {
  key: ExperimentState;
  label: string;
  meaning: string;
  allowedNext: ExperimentState[];
  /** Whether results may be recorded while in this state. */
  acceptsResults: boolean;
  terminal: boolean;
}

export const EXPERIMENT_STATES: Record<ExperimentState, ExperimentStateDefinition> = {
  proposed: {
    key: 'proposed',
    label: 'Proposed',
    meaning: 'Designed but not agreed to. Nobody has committed time or money.',
    allowedNext: ['approved', 'abandoned'],
    acceptsResults: false,
    terminal: false,
  },
  approved: {
    key: 'approved',
    label: 'Approved',
    meaning: 'Agreed to, not yet started. The thresholds are now fixed.',
    allowedNext: ['running', 'abandoned'],
    acceptsResults: false,
    terminal: false,
  },
  running: {
    key: 'running',
    label: 'Running',
    meaning: 'In progress. Results may be recorded as they arrive.',
    allowedNext: ['completed', 'blocked', 'abandoned'],
    acceptsResults: true,
    terminal: false,
  },
  blocked: {
    key: 'blocked',
    label: 'Blocked',
    meaning: 'Started but stuck on something outside the experiment.',
    allowedNext: ['running', 'abandoned'],
    acceptsResults: true,
    terminal: false,
  },
  completed: {
    key: 'completed',
    label: 'Completed',
    meaning: 'Finished, with a verdict measured against the thresholds set beforehand.',
    allowedNext: [],
    acceptsResults: false,
    terminal: true,
  },
  abandoned: {
    key: 'abandoned',
    label: 'Abandoned',
    meaning: 'Stopped without a conclusion. Not the same as a negative result.',
    allowedNext: [],
    acceptsResults: false,
    terminal: true,
  },
};

export type TransitionVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; remedy: string };

export function canTransition(from: ExperimentState, to: ExperimentState): TransitionVerdict {
  const definition = EXPERIMENT_STATES[from];

  if (from === to) {
    return {
      allowed: false,
      reason: `The experiment is already ${EXPERIMENT_STATES[to].label.toLowerCase()}.`,
      remedy: 'No change is needed.',
    };
  }

  if (definition.terminal) {
    return {
      allowed: false,
      reason: `${definition.label} is final. An experiment that has concluded cannot be reopened.`,
      remedy: 'Design a new experiment rather than editing the record of what happened.',
    };
  }

  if (!definition.allowedNext.includes(to)) {
    return {
      allowed: false,
      reason: `An experiment cannot go from ${definition.label.toLowerCase()} to ${EXPERIMENT_STATES[to].label.toLowerCase()}.`,
      remedy: `From here it can only become: ${definition.allowedNext.join(', ')}.`,
    };
  }

  return { allowed: true };
}

export interface ThresholdCheck {
  metric: string;
  value: number;
  required: number;
}

/**
 * Compares what happened against what was agreed beforehand.
 *
 * Deliberately mechanical. The whole reason thresholds are recorded before an
 * experiment runs is so that the verdict is a comparison rather than an
 * interpretation of a disappointing result.
 */
export function judgeExperiment(input: {
  successThreshold: { metric: string; value: number };
  failureThreshold: { metric: string; value: number };
  results: Array<{ metricKey: string; value: number }>;
}): { verdict: ExperimentVerdict; explanation: string; checks: ThresholdCheck[] } {
  const byMetric = new Map(input.results.map((result) => [result.metricKey, result.value]));

  const successValue = byMetric.get(input.successThreshold.metric);
  const failureValue = byMetric.get(input.failureThreshold.metric);

  const checks: ThresholdCheck[] = [];
  if (successValue !== undefined) {
    checks.push({
      metric: input.successThreshold.metric,
      value: successValue,
      required: input.successThreshold.value,
    });
  }

  if (successValue === undefined && failureValue === undefined) {
    return {
      verdict: 'inconclusive',
      explanation:
        'Neither threshold metric was measured, so the experiment cannot say anything about its hypothesis.',
      checks,
    };
  }

  if (successValue !== undefined && successValue >= input.successThreshold.value) {
    return {
      verdict: 'validated',
      explanation: `${input.successThreshold.metric} reached ${successValue}, against the ${input.successThreshold.value} agreed beforehand.`,
      checks,
    };
  }

  if (failureValue !== undefined && failureValue <= input.failureThreshold.value) {
    return {
      verdict: 'rejected',
      explanation: `${input.failureThreshold.metric} was ${failureValue}, at or below the ${input.failureThreshold.value} agreed as failure.`,
      checks,
    };
  }

  // Between the two thresholds: neither confirmed nor refuted, which is a real
  // outcome and must not be rounded towards whichever is more welcome.
  if (successValue !== undefined) {
    const proportion = input.successThreshold.value > 0 ? successValue / input.successThreshold.value : 0;
    return {
      verdict: proportion >= 0.5 ? 'partially_validated' : 'inconclusive',
      explanation: `${input.successThreshold.metric} reached ${successValue} against a target of ${input.successThreshold.value}: short of success, but not the agreed failure either.`,
      checks,
    };
  }

  return {
    verdict: 'inconclusive',
    explanation: 'The results fell between the thresholds agreed beforehand.',
    checks,
  };
}

/**
 * How much an experiment's verdict should move confidence.
 *
 * Real-world evidence outweighs desk research, which is the point of running
 * one -- but a single small experiment is not proof, so the movement is bounded.
 */
export function confidenceEffect(verdict: ExperimentVerdict): {
  delta: number;
  explanation: string;
} {
  switch (verdict) {
    case 'validated':
      return {
        delta: 0.25,
        explanation: 'Real customers behaved as the thesis predicted, which is worth more than any amount of desk research.',
      };
    case 'partially_validated':
      return { delta: 0.1, explanation: 'Some of the thesis held up, some did not.' };
    case 'rejected':
      return {
        delta: -0.35,
        explanation: 'Real customers did not behave as predicted. That is the strongest evidence available.',
      };
    case 'inconclusive':
      return {
        // Nothing was learned, so nothing should move. Nudging confidence
        // upward for having run something would reward activity over evidence.
        delta: 0,
        explanation: 'The experiment did not settle the question, so confidence is unchanged.',
      };
  }
}
