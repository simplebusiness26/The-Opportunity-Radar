import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import { computeEvidenceCounts } from '../../src/domain/dedupe/cascade';
import type { WorkspaceCtx } from '../../src/domain/types/identity';
import { signUp } from '../../src/application/auth/sign-up';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';

const NOW = new Date('2026-08-18T00:00:00Z');

async function setup() {
  const authDeps = buildAuthDeps({ now: NOW });
  const account = await signUp(authDeps, {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const deps = { repos: createRepositories(db), tx: createTransactor(db), clock };
  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };
  return { deps, ctx, clock };
}

const complaint = {
  title: 'Restaurants lose money to no-shows',
  bodyText:
    'We lose four or five covers every Friday to people who book and never turn up, and our booking system makes taking a deposit almost impossible.',
  signalTypeKey: 'pain' as const,
  evidenceClass: 'direct_customer' as const,
  observedAt: NOW,
};

describe('recording evidence', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('creates a new evidence unit for a genuinely new observation', async () => {
    const { deps, ctx } = await setup();
    const result = await recordSignal(deps, ctx, complaint);

    expect(result.outcome).toBe('new_evidence');
    expect(result.dedupeReason).toBe('distinct');
    expect(result.signal.evidenceUnitId).toBeNull();

    const unit = await deps.repos.evidence.findById(ctx.workspaceId, result.evidenceUnitId);
    expect(unit?.mentionCount).toBe(1);
    expect(unit?.independentSourceCount).toBe(1);
  });

  it('computes fingerprints, an embedding and an origin key on the way in', async () => {
    const { deps, ctx } = await setup();
    const result = await recordSignal(deps, ctx, {
      ...complaint,
      url: 'https://www.example.com/thread?utm_source=newsletter',
      authorHandle: 'Jane_Doe',
    });

    const stored = await deps.repos.signals.findById(ctx.workspaceId, result.signal.id);
    expect(stored?.canonicalUrl).toBe('https://example.com/thread');
    expect(stored?.originKey).toBe('example.com');
    expect(stored?.authorIdentityKey).toBe('author:jane_doe');
    expect(stored?.embeddingModel).toBe('lexical-v1');
    expect(stored?.contentHash).toHaveLength(64);
  });

  /**
   * The behaviour the product's credibility depends on: the same story arriving
   * again must not look like a second, independent observation.
   */
  it('does not let the same URL count twice', async () => {
    const { deps, ctx } = await setup();
    const url = 'https://example.com/the-same-thread';

    const first = await recordSignal(deps, ctx, { ...complaint, url });
    const second = await recordSignal(deps, ctx, {
      ...complaint,
      url: `${url}?utm_campaign=share`,
      title: 'A different headline for the same thread',
    });

    expect(second.outcome).not.toBe('new_evidence');
    expect(second.evidenceUnitId).toBe(first.evidenceUnitId);

    const unit = await deps.repos.evidence.findById(ctx.workspaceId, first.evidenceUnitId);
    expect(unit?.mentionCount).toBe(2);
    expect(unit?.independentSourceCount).toBe(1);
  });

  it('does not let identical text count twice, even without a URL', async () => {
    const { deps, ctx } = await setup();
    const first = await recordSignal(deps, ctx, complaint);
    const second = await recordSignal(deps, ctx, { ...complaint, title: 'Reposted elsewhere' });

    expect(second.evidenceUnitId).toBe(first.evidenceUnitId);
    // The body is the claim, so a rewritten headline still matches exactly.
    expect(second.dedupeReason).toBe('content_hash');
  });

  it('records why every decision was made, so it can be explained later', async () => {
    const { deps, ctx } = await setup();
    const result = await recordSignal(deps, ctx, complaint);

    const history = await deps.repos.signals.listProcessing(result.signal.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.stage).toBe('dedupe');
    expect(history[0]?.decision).toBe('distinct');
  });

  it('treats genuinely different observations as separate evidence', async () => {
    const { deps, ctx } = await setup();
    const first = await recordSignal(deps, ctx, complaint);
    const second = await recordSignal(deps, ctx, {
      title: 'Estate agents lose leads after viewings',
      bodyText:
        'Nobody follows up with people who attended a viewing, so warm leads simply go cold within a week or two.',
      signalTypeKey: 'pain',
      evidenceClass: 'direct_customer',
      observedAt: NOW,
    });

    expect(second.outcome).toBe('new_evidence');
    expect(second.evidenceUnitId).not.toBe(first.evidenceUnitId);
  });

  it('counts two different people reporting the same thing as two sources', async () => {
    const { deps, ctx } = await setup();
    const first = await recordSignal(deps, ctx, {
      ...complaint,
      url: 'https://forum-one.test/a',
      authorHandle: 'alice',
    });
    await recordSignal(deps, ctx, {
      ...complaint,
      title: 'Same problem, different restaurant',
      bodyText:
        'Deposits are the only thing that stops no-shows for us, but the booking software we pay for cannot take them at all.',
      url: 'https://forum-two.test/b',
      authorHandle: 'bob',
    });

    const mentions = await deps.repos.evidence.mentionsFor([first.evidenceUnitId]);
    const counts = computeEvidenceCounts(mentions);
    expect(counts.uniqueEvidence).toBe(1);
  });

  /**
   * Hand-entered evidence has no URL to derive an origin from. It must still
   * count as a source -- and two entries naming the same source must still
   * count as one.
   */
  it('counts hand-entered evidence as a source, without inventing independence', async () => {
    const { deps, ctx } = await setup();

    const jane = await recordSignal(deps, ctx, {
      ...complaint,
      sourceLabel: "Interview with the manager at Bella's",
    });
    const unit = await deps.repos.evidence.findById(ctx.workspaceId, jane.evidenceUnitId);
    expect(unit?.independentSourceCount).toBe(1);

    // A second, different interview is a genuinely separate source.
    const omar = await recordSignal(deps, ctx, {
      title: 'Another restaurant on the same problem',
      bodyText:
        'Every weekend we hold tables for bookings that never arrive, and there is no way to charge a deposit through the system we use.',
      signalTypeKey: 'pain',
      evidenceClass: 'direct_customer',
      observedAt: NOW,
      sourceLabel: 'Interview with the owner at Fig & Vine',
    });
    expect(omar.outcome).toBe('new_evidence');

    const janeStored = await deps.repos.signals.findById(ctx.workspaceId, jane.signal.id);
    const omarStored = await deps.repos.signals.findById(ctx.workspaceId, omar.signal.id);
    expect(janeStored?.originKey).not.toBe(omarStored?.originKey);
  });

  it('treats two entries naming the same source as one source', async () => {
    const { deps, ctx } = await setup();
    const label = 'Support ticket queue, March';

    const first = await recordSignal(deps, ctx, { ...complaint, sourceLabel: label });
    await recordSignal(deps, ctx, {
      title: 'Second ticket, same theme',
      bodyText:
        'A different customer wrote in about holding covers for bookings that never show, asking whether deposits are possible.',
      signalTypeKey: 'pain',
      evidenceClass: 'direct_customer',
      observedAt: NOW,
      sourceLabel: label,
    });

    const stored = await deps.repos.signals.list(ctx.workspaceId);
    const origins = new Set(stored.rows.map((row) => row.originKey));
    expect(origins.size).toBe(1);
    expect(first.evidenceUnitId).toBeTruthy();
  });

  it('rejects an observation dated in the future', async () => {
    const { deps, ctx } = await setup();
    await expect(
      recordSignal(deps, ctx, { ...complaint, observedAt: new Date('2027-01-01T00:00:00Z') }),
    ).rejects.toMatchObject({ code: 'signal.future_observation' });
  });

  it('refuses to record evidence for a role that cannot write', async () => {
    const { deps, ctx } = await setup();
    await expect(recordSignal(deps, { ...ctx, role: 'viewer' }, complaint)).rejects.toMatchObject({
      code: 'signals.write_denied',
    });
  });

  it('writes an audit entry for every recorded signal', async () => {
    const { deps, ctx } = await setup();
    await recordSignal(deps, ctx, complaint);

    const entries = await deps.repos.audit.list(ctx.workspaceId, { action: 'signal.recorded' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorUserId).toBe(ctx.userId);
  });

  it('keeps evidence in one workspace invisible to another', async () => {
    const { deps, ctx } = await setup();
    await recordSignal(deps, ctx, complaint);

    const other = await setup();
    const visible = await deps.repos.signals.list(other.ctx.workspaceId);
    expect(visible.total).toBe(0);
  });

  it('excludes demonstration data from ordinary listings by default', async () => {
    const { deps, ctx } = await setup();
    await recordSignal(deps, ctx, { ...complaint, demo: true });

    const normal = await deps.repos.signals.list(ctx.workspaceId);
    const withDemo = await deps.repos.signals.list(ctx.workspaceId, { includeDemo: true });

    expect(normal.total).toBe(0);
    expect(withDemo.total).toBe(1);
  });
});
