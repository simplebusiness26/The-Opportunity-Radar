import { describe, expect, it } from 'vitest';
import { backoffSeconds, decideOutcome, DEFAULT_BACKOFF } from '../../src/domain/jobs/backoff';
import {
  debounceKey,
  MAX_CAUSATION_DEPTH,
  scheduleDedupeKey,
} from '../../src/domain/jobs/schedule';
import { isValidCron, nextDue } from '../../src/jobs/scheduler';
import { EVENT_ROUTES } from '../../src/jobs/event-router';
import { JOB_REGISTRY } from '../../src/jobs/handlers/index';
import { DEFAULT_SCHEDULES } from '../../src/application/system/default-schedules';

describe('retry backoff', () => {
  const fixed = () => 0.5; // midpoint of the jitter band

  it('grows exponentially and then stops at the cap', () => {
    expect(backoffSeconds(1, DEFAULT_BACKOFF, fixed)).toBe(10);
    expect(backoffSeconds(2, DEFAULT_BACKOFF, fixed)).toBe(20);
    expect(backoffSeconds(3, DEFAULT_BACKOFF, fixed)).toBe(40);
    expect(backoffSeconds(20, DEFAULT_BACKOFF, fixed)).toBe(DEFAULT_BACKOFF.maxSeconds);
  });

  it('spreads retries so a shared outage does not produce a stampede', () => {
    const earliest = backoffSeconds(5, DEFAULT_BACKOFF, () => 0);
    const latest = backoffSeconds(5, DEFAULT_BACKOFF, () => 1);
    expect(latest).toBeGreaterThan(earliest);
  });

  it('never returns a delay below one second', () => {
    expect(backoffSeconds(1, { ...DEFAULT_BACKOFF, baseSeconds: 0.1 }, () => 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('deciding what happens to a job that threw', () => {
  it('retries a transient failure until the attempt limit', () => {
    expect(decideOutcome({ attempts: 1, maxAttempts: 3, retryable: true, blocked: false })).toEqual({
      status: 'retrying',
      shouldRetry: true,
    });
    expect(decideOutcome({ attempts: 3, maxAttempts: 3, retryable: true, blocked: false })).toEqual({
      status: 'failed',
      shouldRetry: false,
    });
  });

  it('does not retry a failure that cannot succeed', () => {
    expect(decideOutcome({ attempts: 1, maxAttempts: 5, retryable: false, blocked: false })).toEqual({
      status: 'failed',
      shouldRetry: false,
    });
  });

  it('holds rather than fails when a precondition is missing', () => {
    // A job waiting on an unconnected provider must not burn its retries and
    // disappear; it waits for the owner and resumes.
    const outcome = decideOutcome({ attempts: 9, maxAttempts: 3, retryable: true, blocked: true });
    expect(outcome).toEqual({ status: 'blocked', shouldRetry: false });
  });
});

describe('schedule keys', () => {
  it('produces one key per due bucket, not per attempt to fire it', () => {
    const due = new Date('2026-08-18T06:00:00Z');
    expect(scheduleDedupeKey('brief.generate', due)).toBe(
      'schedule:brief.generate:2026-08-18T06:00:00.000Z',
    );
    // Two workers computing the same bucket must agree exactly, or the queue's
    // uniqueness constraint cannot collapse them.
    expect(scheduleDedupeKey('brief.generate', new Date(due))).toBe(
      scheduleDedupeKey('brief.generate', due),
    );
  });

  it('separates different schedules and different buckets', () => {
    const a = scheduleDedupeKey('brief.generate', new Date('2026-08-18T06:00:00Z'));
    const b = scheduleDedupeKey('brief.generate', new Date('2026-08-19T06:00:00Z'));
    const c = scheduleDedupeKey('alerts.evaluate', new Date('2026-08-18T06:00:00Z'));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('cron parsing', () => {
  it('computes the next firing', () => {
    const from = new Date('2026-08-18T05:30:00Z');
    expect(nextDue('0 6 * * *', from)?.toISOString()).toBe('2026-08-18T06:00:00.000Z');
  });

  it('disables an unparseable schedule instead of throwing', () => {
    // One bad expression must not stop every other schedule in the workspace.
    expect(nextDue('not a cron', new Date('2026-08-18T00:00:00Z'))).toBeNull();
    expect(isValidCron('not a cron')).toBe(false);
  });

  it('accepts every default schedule shipped with the product', () => {
    for (const schedule of DEFAULT_SCHEDULES) {
      expect(isValidCron(schedule.cron), `${schedule.key}: ${schedule.cron}`).toBe(true);
    }
  });
});

describe('the event routing table', () => {
  it('routes only to jobs that actually exist', () => {
    for (const [event, routes] of Object.entries(EVENT_ROUTES)) {
      for (const route of routes) {
        expect(JOB_REGISTRY.has(route.jobKind), `${event} -> ${route.jobKind}`).toBe(true);
      }
    }
  });

  it('debounces the fan-out that a large ingest would otherwise cause', () => {
    // A scan producing five hundred signals must rescore each opportunity once.
    // Any route without a debounce subject is a route that can stampede.
    const stampedeProne = Object.entries(EVENT_ROUTES).flatMap(([event, routes]) =>
      routes.filter((route) => !route.debounceOn).map((route) => `${event} -> ${route.jobKind}`),
    );
    expect(stampedeProne).toEqual([]);
  });

  it('collapses a burst onto one key per subject', () => {
    expect(debounceKey('opportunity.score', 'opp-1')).toBe(
      debounceKey('opportunity.score', 'opp-1'),
    );
    expect(debounceKey('opportunity.score', 'opp-1')).not.toBe(
      debounceKey('opportunity.score', 'opp-2'),
    );
  });

  it('caps how deep a chain of caused work may go', () => {
    expect(MAX_CAUSATION_DEPTH).toBeGreaterThan(0);
    expect(MAX_CAUSATION_DEPTH).toBeLessThanOrEqual(10);
  });
});

describe('the job registry', () => {
  it('describes every job it registers', () => {
    for (const [kind, definition] of JOB_REGISTRY) {
      expect(definition.description.length, kind).toBeGreaterThan(10);
    }
  });

  it('has a handler for every default schedule', () => {
    for (const schedule of DEFAULT_SCHEDULES) {
      expect(JOB_REGISTRY.has(schedule.jobKind), schedule.key).toBe(true);
    }
  });
});
