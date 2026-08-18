import { assignUnclusteredEvidence, recomputeCluster } from '../../application/clusters/cluster-evidence';
import { rescoreOpportunity } from '../../application/opportunities/score-opportunity';
import { generateBrief } from '../../application/system/brief';
import { evaluateAlerts } from '../../application/system/alerts';
import { refreshEvidenceStrength } from '../../application/system/decay-refresh';
import { defineJobs, type JobContext } from '../types';
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
]);
