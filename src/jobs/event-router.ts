import { debounceKey, DEBOUNCE_SECONDS, MAX_CAUSATION_DEPTH } from '../domain/jobs/schedule';
import type { Clock } from '../ports/clock';
import type { Repositories } from '../ports/repositories/index';
import type { DomainEventRow } from '../ports/repositories/ops';

/**
 * What each domain event causes.
 *
 * Written as data rather than as calls scattered through handlers, so the whole
 * recomputation graph is legible in one place -- and so a change to it is a
 * change to a table, not an archaeology exercise.
 *
 * `debounceOn` names the field whose value collapses a burst into one job. A
 * scan producing five hundred signals must recompute each affected opportunity
 * once, not five hundred times.
 */
export interface EventRoute {
  jobKind: string;
  /** Payload field identifying the subject to debounce on. */
  debounceOn?: string;
  delaySeconds?: number;
  priority?: number;
}

/**
 * The table holds only routes whose handler exists today. Later phases add
 * their own routes alongside their handlers, and a test asserts the two never
 * drift apart -- a route pointing at a job nobody implemented would silently
 * swallow the event it was meant to act on.
 */
export const EVENT_ROUTES: Record<string, EventRoute[]> = {
  'evidence.created': [
    { jobKind: 'cluster.assign', debounceOn: 'workspace', delaySeconds: DEBOUNCE_SECONDS },
    // Debounced on the workspace: one sweep covers every trigger, however much
    // evidence arrived in the burst.
    { jobKind: 'triggers.evaluate', debounceOn: 'workspace', delaySeconds: DEBOUNCE_SECONDS },
  ],
  'evidence.strengthened': [
    { jobKind: 'cluster.recompute', debounceOn: 'clusterId', delaySeconds: DEBOUNCE_SECONDS },
  ],
  'evidence.decayed': [
    { jobKind: 'cluster.recompute', debounceOn: 'clusterId', delaySeconds: DEBOUNCE_SECONDS },
  ],
  'cluster.changed': [
    { jobKind: 'opportunity.score', debounceOn: 'opportunityId', delaySeconds: DEBOUNCE_SECONDS },
  ],
  'opportunity.evidence_changed': [
    { jobKind: 'opportunity.score', debounceOn: 'opportunityId', delaySeconds: DEBOUNCE_SECONDS },
  ],
  'experiment.result_recorded': [
    { jobKind: 'opportunity.score', debounceOn: 'opportunityId', delaySeconds: 0, priority: 5 },
  ],
  'opportunity.handed_off': [
    { jobKind: 'handoff.deliver', debounceOn: 'handoffId', delaySeconds: 0, priority: 5 },
  ],
  'execution.outcome_recorded': [
    { jobKind: 'opportunity.score', debounceOn: 'opportunityId', delaySeconds: 0, priority: 4 },
  ],
  'score.changed': [
    { jobKind: 'alerts.evaluate', debounceOn: 'opportunityId', delaySeconds: 0, priority: 3 },
    { jobKind: 'brief.mark_dirty', debounceOn: 'workspace', delaySeconds: DEBOUNCE_SECONDS },
  ],
};

export interface ProjectionResult {
  processed: number;
  enqueued: number;
  debounced: number;
  droppedTooDeep: number;
}

/**
 * Consumes the outbox in sequence order and enqueues the work each event
 * causes. Events are marked processed only after their jobs are enqueued, so a
 * crash mid-batch replays rather than loses them; the dedupe key makes the
 * replay harmless.
 */
export async function projectEvents(
  deps: { repos: Repositories; clock: Clock },
  options: { limit?: number } = {},
): Promise<ProjectionResult> {
  const events = await deps.repos.events.listUnprocessed(options.limit ?? 200);
  const result: ProjectionResult = { processed: 0, enqueued: 0, debounced: 0, droppedTooDeep: 0 };
  if (events.length === 0) return result;

  const now = deps.clock.now();
  const handled: number[] = [];

  for (const event of events) {
    const routes = EVENT_ROUTES[event.kind] ?? [];

    for (const route of routes) {
      // A chain of events that keeps causing itself is a bug; refusing past a
      // fixed depth turns an infinite loop into a bounded, visible one.
      if (event.causationDepth >= MAX_CAUSATION_DEPTH) {
        result.droppedTooDeep += 1;
        continue;
      }

      const subject = subjectFor(event, route);
      const job = await deps.repos.jobs.enqueue(event.workspaceId, {
        kind: route.jobKind,
        payload: { ...event.payload, eventKind: event.kind, subjectId: event.subjectId },
        dedupeKey: subject ? debounceKey(route.jobKind, subject) : null,
        runAt: new Date(now.getTime() + (route.delaySeconds ?? 0) * 1000),
        priority: route.priority ?? 0,
        causationDepth: event.causationDepth + 1,
      });

      if (job) result.enqueued += 1;
      else result.debounced += 1;
    }

    handled.push(event.sequence);
    result.processed += 1;
  }

  await deps.repos.events.markProcessed(handled, now);
  return result;
}

function subjectFor(event: DomainEventRow, route: EventRoute): string | null {
  if (!route.debounceOn) return null;
  if (route.debounceOn === 'workspace') return event.workspaceId;

  const fromPayload = event.payload[route.debounceOn];
  if (typeof fromPayload === 'string') return fromPayload;

  return event.subjectId;
}
