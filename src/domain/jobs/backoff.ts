/**
 * Retry timing, kept pure so the schedule can be asserted exactly rather than
 * observed by waiting.
 */

export interface BackoffPolicy {
  baseSeconds: number;
  factor: number;
  maxSeconds: number;
  /** Fraction of the delay that is randomised, to avoid a retry thundering herd. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseSeconds: 10,
  factor: 2,
  maxSeconds: 3600,
  jitter: 0.2,
};

/**
 * Delay before attempt `attempt` (1-based). `random` is injected rather than
 * called, so tests get a deterministic schedule and production still spreads.
 */
export function backoffSeconds(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = policy.baseSeconds * policy.factor ** exponent;
  const capped = Math.min(raw, policy.maxSeconds);
  // Jitter is symmetric so the mean delay stays on the curve.
  const spread = capped * policy.jitter;
  return Math.max(1, Math.round(capped - spread + random() * spread * 2));
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'blocked';

/**
 * What should happen to a job that just threw.
 *
 * A missing precondition -- no AI provider, budget spent -- is not a failure and
 * must not burn retries: the job is held and resumes when the precondition
 * returns. Genuine errors retry until the attempt limit, then stop.
 */
export type FailureOutcome = Extract<JobStatus, 'failed' | 'retrying' | 'blocked'>;

export function decideOutcome(input: {
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
  blocked: boolean;
}): { status: FailureOutcome; shouldRetry: boolean } {
  if (input.blocked) return { status: 'blocked', shouldRetry: false };
  if (!input.retryable) return { status: 'failed', shouldRetry: false };
  if (input.attempts >= input.maxAttempts) return { status: 'failed', shouldRetry: false };
  return { status: 'retrying', shouldRetry: true };
}
