/**
 * Turning a schedule into work.
 *
 * The scheduler does not remember what it has already fired. Instead each due
 * time produces a stable key, and the queue's uniqueness constraint on pending
 * work does the rest: two workers ticking simultaneously, a tick that runs
 * twice, or a clock that jumps backwards all converge on one job per bucket.
 */

/** Key for the run of `scheduleKey` due at `dueAt`. Stable and collision-free. */
export function scheduleDedupeKey(scheduleKey: string, dueAt: Date): string {
  return `schedule:${scheduleKey}:${dueAt.toISOString()}`;
}

/**
 * Debounce key for work triggered by an event.
 *
 * A burst of five hundred signals must not produce five hundred rescores of the
 * same opportunity. The key collapses them, and the delay gives the burst time
 * to finish before the single recompute runs.
 */
export function debounceKey(kind: string, subjectId: string): string {
  return `${kind}:${subjectId}`;
}

export const DEBOUNCE_SECONDS = 30;

/** Depth at which a chain of event-triggered work is refused. */
export const MAX_CAUSATION_DEPTH = 6;
