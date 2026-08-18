import { assignUnclusteredEvidence, recomputeCluster } from '../../application/clusters/cluster-evidence';
import { rescoreOpportunity } from '../../application/opportunities/score-opportunity';
import { generateBrief } from '../../application/system/brief';
import { evaluateAlerts } from '../../application/system/alerts';
import { refreshEvidenceStrength } from '../../application/system/decay-refresh';
import { ingestSource } from '../../application/sources/ingest';
import { investigateOpportunity } from '../../pipeline/investigations/runner';
import { decideDepth } from '../../domain/investigation/policy';
import { evaluateTriggers } from '../../application/memory/triggers';
import { defineJobs, JobBlocked, type JobContext } from '../types';
import { projectEvents } from '../event-router';

/**
 * The registry of work Radar can do on its own.
 *
 * Every job here runs with a system context, which is deliberately not a
 * superuser: it may ingest, group, score and alert, but it may never take a
 * decision that belongs to the owner, change a budget, or touch a credential.
 * A compromised source therefore cannot escalate through a job.
 */

function systemCtx(context: JobContext) {
  return {
    workspaceId: context.job.workspaceId,
    orgId: '',
    actor: 'job' as const,
    jobId: context.job.id,
  };
}

function deps(context: JobContext) {
  return { repos: context.repos, tx: context.tx, clock: context.clock };
}

export const JOB_REGISTRY = defineJobs([
  {
    kind: 'source.scan',
    description: 'Fetches from one configured source and records what was new.',
    timeoutSec: 300,
    requires: 'sources',
    handler: async (context) => {
      const sourceId = String(context.job.payload.sourceId ?? '');
      if (!sourceId) return { detail: { skipped: 'no source identified' } };

      const ingest = context.ingest;
      if (!ingest) {
        throw new JobBlocked(
          'Ingestion is not available in this worker.',
          'Run the worker built with the ingestion dependencies.',
        );
      }

      const result = await ingestSource(ingest, systemCtx(context), sourceId, {
        runId: context.job.runId ?? undefined,
      });

      if (result.status === 'not_configured') {
        // Held rather than failed: the source is waiting for the owner, and it
        // resumes as soon as the missing setting arrives.
        throw new JobBlocked(result.message, result.remedy ?? 'Complete the source settings.');
      }

      return {
        detail: {
          source: result.sourceName,
          seen: result.itemsSeen,
          newEvidence: result.newEvidence,
          duplicates: result.duplicates,
        },
      };
    },
  },
  {
    kind: 'sources.poll',
    description: 'Enqueues a scan for every source that is due one.',
    timeoutSec: 60,
    handler: async (context) => {
      const due = await context.repos.sources.listDue(context.clock.now(), 25);

      let enqueued = 0;
      for (const source of due) {
        const job = await context.repos.jobs.enqueue(source.workspaceId, {
          kind: 'source.scan',
          payload: { sourceId: source.id },
          // One scan per source at a time, however often polling runs.
          dedupeKey: `source.scan:${source.id}`,
          runId: context.job.runId,
        });
        if (job) enqueued += 1;
      }

      return { detail: { due: due.length, enqueued } };
    },
  },
  {
    kind: 'events.project',
    description: 'Consumes the domain event outbox and enqueues the work each event causes.',
    timeoutSec: 120,
    handler: async (context) => {
      const result = await projectEvents(deps(context));
      return { detail: { ...result } };
    },
  },
  {
    kind: 'cluster.assign',
    description: 'Places evidence that is not yet in a problem into the one it fits.',
    timeoutSec: 300,
    handler: async (context) => {
      const outcomes = await assignUnclusteredEvidence(deps(context), systemCtx(context), {
        limit: 200,
      });
      return {
        detail: {
          considered: outcomes.length,
          assigned: outcomes.filter((outcome) => outcome.clusterId).length,
          // Reported rather than hidden: unmatched evidence is a real state,
          // and a persistently high count means the thresholds need attention.
          unassigned: outcomes.filter((outcome) => !outcome.clusterId).length,
        },
      };
    },
  },
  {
    kind: 'cluster.recompute',
    description: "Recomputes a problem's evidence counts, diversity and confidence.",
    timeoutSec: 120,
    handler: async (context) => {
      const clusterId = String(context.job.payload.clusterId ?? context.job.payload.subjectId ?? '');
      if (!clusterId) return { detail: { skipped: 'no cluster identified' } };

      const cluster = await recomputeCluster(deps(context), systemCtx(context), clusterId);
      return {
        detail: {
          uniqueEvidence: cluster.uniqueEvidenceCount,
          independentSources: cluster.independentSourceCount,
          confidence: cluster.confidence,
        },
      };
    },
  },
  {
    kind: 'opportunity.score',
    description: 'Rescores an opportunity and records what moved and why.',
    timeoutSec: 180,
    handler: async (context) => {
      const opportunityId = String(
        context.job.payload.opportunityId ?? context.job.payload.subjectId ?? '',
      );
      if (!opportunityId) return { detail: { skipped: 'no opportunity identified' } };

      const cause = context.job.payload.eventKind === 'experiment.result_recorded'
        ? 'experiment_result'
        : context.job.payload.eventKind === 'evidence.decayed'
          ? 'decay'
          : 'new_evidence';

      const result = await rescoreOpportunity(deps(context), systemCtx(context), opportunityId, {
        cause,
      });

      return {
        detail: {
          attractiveness: result.result.composites.attractiveness,
          confidence: result.result.confidence.value,
          changed: result.changed,
        },
      };
    },
  },
  {
    kind: 'evidence.refresh_decay',
    description: 'Reapplies time decay to stored evidence and reports threshold crossings.',
    timeoutSec: 300,
    handler: async (context) => {
      const result = await refreshEvidenceStrength(deps(context), systemCtx(context));
      return { detail: { ...result } };
    },
  },
  {
    kind: 'alerts.evaluate',
    description: 'Raises alerts for changes that genuinely warrant attention.',
    timeoutSec: 120,
    handler: async (context) => {
      const result = await evaluateAlerts(deps(context), systemCtx(context));
      return { detail: { ...result } };
    },
  },
  {
    kind: 'brief.generate',
    description: 'Writes the daily brief from what actually changed.',
    timeoutSec: 180,
    handler: async (context) => {
      const brief = await generateBrief(deps(context), systemCtx(context));
      return { detail: { briefDate: brief.briefDate, ...(brief.metrics as object) } };
    },
  },
  {
    kind: 'brief.mark_dirty',
    description: 'Notes that the brief needs regenerating after a scored change.',
    timeoutSec: 60,
    handler: async (context) => {
      // Regenerating on every score change would rewrite the brief all day. The
      // brief is instead regenerated on its schedule, and this simply records
      // that something moved since the last one.
      await context.log('brief_dirty', 'A score changed since the last brief was written.');
      return { detail: { marked: true } };
    },
  },
  {
    kind: 'jobs.reap',
    description: 'Reclaims work whose worker stopped reporting.',
    timeoutSec: 60,
    handler: async (context) => {
      const reaped = await context.repos.jobs.reapExpired(context.clock.now(), (attempt) =>
        Math.min(3600, 10 * 2 ** Math.max(0, attempt - 1)),
      );
      return { detail: { reaped } };
    },
  },
  {
    kind: 'sessions.purge',
    description: 'Deletes expired and revoked sessions.',
    timeoutSec: 60,
    handler: async (context) => {
      const removed = await context.repos.sessions.deleteDead(context.clock.now());
      return { detail: { removed } };
    },
  },
  {
    kind: 'opportunity.investigate',
    description: 'Runs the investigation roles that the depth policy has earned.',
    timeoutSec: 900,
    requires: 'ai',
    handler: async (context) => {
      const opportunityId = String(context.job.payload.opportunityId ?? '');
      if (!opportunityId) return { detail: { skipped: 'no opportunity identified' } };

      const investigation = context.investigation;
      if (!investigation) {
        throw new JobBlocked(
          'Investigation is not available in this worker.',
          'Run the worker built with the AI gateway.',
        );
      }

      const outcome = await investigateOpportunity(investigation, systemCtx(context), opportunityId, {
        jobId: context.job.id,
        runId: context.job.runId ?? undefined,
        runCapUsd: typeof context.job.payload.runCapUsd === 'number' ? context.job.payload.runCapUsd : undefined,
      });

      if (outcome.blockedBy) {
        // Held rather than failed: no provider, or the budget is spent. Either
        // resolves on its own -- one when the owner connects something, the
        // other at period rollover.
        throw new JobBlocked(outcome.blockedBy, 'Connect a provider, or raise the budget.');
      }

      return {
        detail: {
          stage: outcome.stage,
          proceeded: outcome.proceeded,
          reason: outcome.reason,
          rolesRun: outcome.runs.filter((run) => run.status === 'complete').map((run) => run.role),
          recommendation: outcome.recommendation,
          counterEvidence: outcome.counterEvidenceAttached,
          costUsd: outcome.costUsd,
        },
      };
    },
  },
  {
    kind: 'opportunities.sweep_investigations',
    description: 'Finds opportunities that have earned their next investigation stage.',
    timeoutSec: 300,
    handler: async (context) => {
      const opportunities = await context.repos.opportunities.list(context.job.workspaceId, {
        states: ['detected', 'watching', 'investigating', 'candidate'],
        limit: 100,
      });

      let enqueued = 0;
      let held = 0;

      for (const opportunity of opportunities) {
        const score = await context.repos.scores.current(context.job.workspaceId, opportunity.id);
        const completedRoles = await context.repos.investigations.completedRoles(
          context.job.workspaceId,
          'opportunity',
          opportunity.id,
        );

        // The gate is evaluated here as well as inside the runner, so a
        // workspace full of thin candidates does not queue a hundred jobs that
        // will each immediately refuse.
        const decision = decideDepth({
          uniqueEvidenceCount: readEvidenceCount(score?.inputsSnapshot, 'uniqueEvidence'),
          independentSourceCount: readEvidenceCount(score?.inputsSnapshot, 'independentSources'),
          preliminaryScore: score?.attractiveness ?? 0,
          confidence: score?.confidence ?? 0,
          hasSpendingEvidence: false,
          completedRoles,
          redTeamVerdict: null,
        });

        if (!decision.proceed) {
          held += 1;
          continue;
        }

        const job = await context.repos.jobs.enqueue(context.job.workspaceId, {
          kind: 'opportunity.investigate',
          payload: { opportunityId: opportunity.id },
          dedupeKey: `opportunity.investigate:${opportunity.id}`,
          runId: context.job.runId,
        });
        if (job) enqueued += 1;
      }

      return { detail: { considered: opportunities.length, enqueued, held } };
    },
  },
  {
    kind: 'triggers.evaluate',
    description: 'Checks re-evaluation triggers against evidence that has arrived since.',
    timeoutSec: 120,
    handler: async (context) => {
      const result = await evaluateTriggers(deps(context), systemCtx(context));
      return {
        detail: {
          triggersChecked: result.triggersChecked,
          signalsChecked: result.signalsChecked,
          fired: result.fired.length,
          reopened: result.fired.filter((entry) => entry.reopened).length,
        },
      };
    },
  },
]);

/**
 * Reads one of the headline evidence counts out of a stored score.
 *
 * The counts are part of the frozen input snapshot the score was computed
 * from, which is exactly what should gate further spending: the sweep asks
 * what was true when the score was taken, rather than recomputing the whole
 * evidence picture for every opportunity it looks at.
 */
function readEvidenceCount(snapshot: unknown, key: 'uniqueEvidence' | 'independentSources'): number {
  if (typeof snapshot !== 'object' || snapshot === null) return 0;
  const evidence = (snapshot as { evidence?: unknown }).evidence;
  if (typeof evidence !== 'object' || evidence === null) return 0;
  const value = (evidence as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}
