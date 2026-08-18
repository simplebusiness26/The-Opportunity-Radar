/**
 * The opportunity lifecycle.
 *
 * Promotion gates exist to stop expensive work being spent on weak evidence.
 * Every transition is explicit and auditable, and the illegal ones are as
 * important as the legal ones: nothing may jump from a hunch to execution
 * without passing through investigation and validation.
 */

export type OpportunityState =
  | 'detected'
  | 'watching'
  | 'investigating'
  | 'candidate'
  | 'validation_ready'
  | 'validating'
  | 'validated'
  | 'execution'
  | 'rejected'
  | 'archived'
  | 'reopened';

export interface StateDefinition {
  key: OpportunityState;
  label: string;
  meaning: string;
  /** Whether reaching this state should consume real resources. */
  consumesResources: boolean;
  terminal: boolean;
}

export const OPPORTUNITY_STATES: Record<OpportunityState, StateDefinition> = {
  detected: {
    key: 'detected',
    label: 'Detected',
    meaning: 'An interesting pattern exists. Nothing has been checked yet.',
    consumesResources: false,
    terminal: false,
  },
  watching: {
    key: 'watching',
    label: 'Watching',
    meaning: 'Plausible, but there is not enough evidence to justify spending on it.',
    consumesResources: false,
    terminal: false,
  },
  investigating: {
    key: 'investigating',
    label: 'Investigating',
    meaning: 'Worth spending research effort on.',
    consumesResources: true,
    terminal: false,
  },
  candidate: {
    key: 'candidate',
    label: 'Candidate',
    meaning: 'The thesis survived investigation, including a deliberate attempt to kill it.',
    consumesResources: false,
    terminal: false,
  },
  validation_ready: {
    key: 'validation_ready',
    label: 'Validation ready',
    meaning: 'A real-world test is warranted and an experiment has been designed.',
    consumesResources: false,
    terminal: false,
  },
  validating: {
    key: 'validating',
    label: 'Validating',
    meaning: 'An experiment is running against real people.',
    consumesResources: true,
    terminal: false,
  },
  validated: {
    key: 'validated',
    label: 'Validated',
    meaning: 'Real-world evidence supports execution.',
    consumesResources: false,
    terminal: false,
  },
  execution: {
    key: 'execution',
    label: 'Execution',
    meaning: 'Resources are committed and the work is being built.',
    consumesResources: true,
    terminal: false,
  },
  rejected: {
    key: 'rejected',
    label: 'Rejected',
    meaning: 'The thesis failed. The reason and its re-evaluation triggers are kept.',
    consumesResources: false,
    terminal: false,
  },
  archived: {
    key: 'archived',
    label: 'Archived',
    meaning: 'No longer relevant, and not expected to become relevant.',
    consumesResources: false,
    terminal: false,
  },
  reopened: {
    key: 'reopened',
    label: 'Reopened',
    meaning: 'Something changed that undermines the original reason for rejection.',
    consumesResources: false,
    terminal: false,
  },
};

/**
 * Legal transitions. Anything absent here is refused, so the path from evidence
 * to committed resources cannot be short-circuited by a bug or an eager agent.
 */
const TRANSITIONS: Record<OpportunityState, readonly OpportunityState[]> = {
  detected: ['watching', 'investigating', 'rejected', 'archived'],
  watching: ['investigating', 'rejected', 'archived'],
  investigating: ['candidate', 'watching', 'rejected', 'archived'],
  candidate: ['validation_ready', 'investigating', 'watching', 'rejected', 'archived'],
  validation_ready: ['validating', 'candidate', 'rejected', 'archived'],
  validating: ['validated', 'candidate', 'rejected', 'archived'],
  // Execution requires validation. There is deliberately no route from
  // 'candidate' or 'detected' straight to 'execution'.
  validated: ['execution', 'validation_ready', 'rejected', 'archived'],
  execution: ['validated', 'rejected', 'archived'],
  rejected: ['reopened', 'archived'],
  archived: ['reopened'],
  reopened: ['watching', 'investigating', 'candidate', 'rejected', 'archived'],
};

export function canTransition(from: OpportunityState, to: OpportunityState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: OpportunityState): readonly OpportunityState[] {
  return TRANSITIONS[from];
}

export interface TransitionRequest {
  from: OpportunityState;
  to: OpportunityState;
  /** Why. Recorded on the transition; a state change without one is refused. */
  reason: string;
  actorKind: 'user' | 'system' | 'job';
}

export type TransitionVerdict =
  | { ok: true }
  | { ok: false; code: 'illegal_transition' | 'reason_required' | 'requires_human'; message: string };

/**
 * States that commit money, effort or an irreversible decision are reserved for
 * a person. Radar recommends; it does not decide to spend on the owner's behalf.
 */
const HUMAN_ONLY_STATES: readonly OpportunityState[] = ['execution', 'validating', 'archived'];

export function evaluateTransition(request: TransitionRequest): TransitionVerdict {
  if (!canTransition(request.from, request.to)) {
    return {
      ok: false,
      code: 'illegal_transition',
      message: `An opportunity cannot move from ${request.from} to ${request.to}. Allowed: ${allowedTransitions(request.from).join(', ') || 'none'}.`,
    };
  }

  if (!request.reason.trim()) {
    return {
      ok: false,
      code: 'reason_required',
      message: 'Every state change records why it happened.',
    };
  }

  if (request.actorKind !== 'user' && HUMAN_ONLY_STATES.includes(request.to)) {
    return {
      ok: false,
      code: 'requires_human',
      message: `Moving to ${request.to} commits real resources, so it needs a person.`,
    };
  }

  return { ok: true };
}

/** States in which the opportunity is actively being worked on. */
export const ACTIVE_STATES: readonly OpportunityState[] = [
  'investigating',
  'candidate',
  'validation_ready',
  'validating',
  'validated',
  'execution',
];

export const CLOSED_STATES: readonly OpportunityState[] = ['rejected', 'archived'];

export const OPPORTUNITY_STATE_KEYS = Object.keys(OPPORTUNITY_STATES) as OpportunityState[];
