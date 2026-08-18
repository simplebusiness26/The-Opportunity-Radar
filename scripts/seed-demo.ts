/**
 * Seeds a demonstration workspace.
 *
 * Everything written here is flagged `demo: true`, and every surface that shows
 * a demo object renders a DEMO badge next to it. That rule is absolute: sample
 * data indistinguishable from real evidence would undermine the one thing this
 * product sells, which is that its numbers mean what they say.
 *
 * The scenario is deliberately not a triumph. It contains one opportunity worth
 * pursuing, one that looks attractive and is not, and one that was rejected and
 * is now watching for the thing that would change our mind -- because those are
 * the three outcomes a person needs to recognise.
 */
import { loadEnvFile } from '../src/composition/load-env-file';
import { buildContainer } from '../src/composition/container';
import { signUp } from '../src/application/auth/sign-up';
import { recordSignal } from '../src/application/signals/record-signal';
import {
  attachEvidence,
  createOpportunity,
  transitionOpportunity,
} from '../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../src/application/opportunities/score-opportunity';
import {
  recordAsset,
  recordCapability,
  recordGoal,
  recordResource,
} from '../src/application/intelligence/capability-profile';
import { createTrigger } from '../src/application/memory/triggers';
import { recordExecutionOutcome } from '../src/application/memory/execution';
import { scaledLimits } from '../src/domain/auth/rate-limit';
import { resolveCapability } from '../src/domain/taxonomy/capabilities';
import type { WorkspaceCtx } from '../src/domain/types/identity';

const EMAIL = 'demo@opportunity-radar.invalid';
const PASSWORD = 'demo-password-not-for-real-use';

async function main(): Promise<void> {
  loadEnvFile();
  const c = buildContainer();

  const existing = await c.repos.users.count();
  if (existing > 0 && process.env.RADAR_SEED_ANYWAY !== 'true') {
    process.stderr.write(
      'This installation already has an account, so the demo seed will not run.\n' +
        'Set RADAR_SEED_ANYWAY=true to add a demo workspace alongside it.\n',
    );
    process.exit(1);
  }

  const account = await signUp(
    {
      repos: c.repos,
      tx: c.tx,
      clock: c.clock,
      rateLimiter: c.rateLimiter,
      limits: scaledLimits(1000),
      passwords: c.passwords,
      tokens: c.tokens,
      ipSalt: c.ipSalt,
      singleOwner: false,
    },
    {
      email: EMAIL,
      password: PASSWORD,
      displayName: 'Demo owner',
      workspaceName: 'DEMO — Radar',
    },
  );

  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'demo',
    userId: account.userId,
    role: 'owner',
  };
  const deps = { repos: c.repos, tx: c.tx, clock: c.clock };
  const now = c.clock.now();

  // ---------------------------------------------------------------- what we have
  await recordAsset(deps, ctx, {
    name: 'DEMO billing-service',
    assetKind: 'service',
    reuseReadiness: 'drop_in',
    summary: 'Demonstration data. Takes card payments and handles refunds.',
  });
  await recordCapability(deps, ctx, {
    name: 'DEMO taking payments',
    capability: 'card payments',
    maturity: 'production',
    evidenceStrength: 0.9,
    providedBy: ['DEMO billing-service'],
  });
  await recordResource(deps, ctx, {
    name: 'DEMO engineering time',
    resourceKind: 'time',
    amount: 20,
    unit: 'days',
    period: 'month',
    committed: 0,
  });
  await recordResource(deps, ctx, {
    name: 'DEMO budget',
    resourceKind: 'budget',
    amount: 4000,
    unit: 'GBP',
    period: 'month',
    committed: 0,
  });
  await recordGoal(deps, ctx, {
    name: 'DEMO revenue within two quarters',
    horizon: 'quarter',
    priority: 8,
  });

  // ------------------------------------------------- a genuinely promising one
  const promising = await createOpportunity(deps, ctx, {
    title: 'DEMO deposit automation for restaurant bookings',
    thesis:
      'Independent restaurants already pay for booking software and pay separately for deposits. One tool that does both is worth more than either.',
    typeKey: 'new_product',
    targetCustomer: 'Independent restaurants with 20 to 60 covers',
    problemStatement: 'No-shows cost covers every weekend and deposits cannot be taken in the booking flow.',
    whyNow: 'Pre-authorisation limits were extended to small merchants this year.',
    demo: true,
  });

  for (const seed of [
    {
      title: 'DEMO restaurant pays for booking software that cannot take deposits',
      bodyText:
        'Demonstration data. We pay 180 a month for our booking system and it still cannot take a deposit, so we eat the loss every weekend.',
      url: 'https://demo-restaurant-owners.invalid/thread-1',
      signalTypeKey: 'spending' as const,
      evidenceClass: 'direct_customer' as const,
      monetaryEvidence: { monthlyAmount: 180, currency: 'GBP' },
    },
    {
      title: 'DEMO second site pays a separate tool purely for deposits',
      bodyText:
        'Demonstration data. We bolted on a payments tool at 45 a month purely to hold deposits, and it does not talk to the booking system.',
      url: 'https://demo-independent-hospitality.invalid/deposits',
      signalTypeKey: 'spending' as const,
      evidenceClass: 'direct_customer' as const,
      monetaryEvidence: { monthlyAmount: 45, currency: 'GBP' },
    },
    {
      title: 'DEMO trade body reports the cost of no-shows',
      bodyText:
        'Demonstration data. A survey of member restaurants put the annual cost of no-shows in the low thousands per site.',
      url: 'https://demo-hospitality-association.invalid/report',
      signalTypeKey: 'pain' as const,
      evidenceClass: 'primary' as const,
    },
    {
      title: 'DEMO booking platform limits deposits to its enterprise tier',
      bodyText:
        'Demonstration data. The feature is limited to their enterprise tier, well above what an independent site would pay.',
      url: 'https://demo-booking-vendor.invalid/changelog',
      signalTypeKey: 'competitor_weakness' as const,
      evidenceClass: 'primary' as const,
    },
  ]) {
    const recorded = await recordSignal(deps, ctx, { ...seed, observedAt: now, demo: true });
    await attachEvidence(deps, ctx, promising.id, {
      evidenceUnitId: recorded.evidenceUnitId,
      stance: 'for',
    });
  }

  await deps.repos.opportunities.setCapabilityRequirements(ctx.workspaceId, promising.id, [
    {
      label: 'card payments',
      taxonomyKey: resolveCapability('card payments').key,
      criticality: 'essential',
      resolvedBy: 'alias',
    },
  ]);
  await rescoreOpportunity(deps, ctx, promising.id, { cause: 'new_evidence' });

  // ------------------------------------------ one that looks good and is not
  const loud = await createOpportunity(deps, ctx, {
    title: 'DEMO group scheduling for amateur sports clubs',
    thesis: 'Everyone complains about organising fixtures, so a tool for it should sell.',
    typeKey: 'new_product',
    problemStatement: 'Organising a weekly fixture across twenty people is painful.',
    demo: true,
  });

  for (let index = 0; index < 4; index += 1) {
    const recorded = await recordSignal(deps, ctx, {
      title: `DEMO complaint thread ${index + 1} about organising fixtures`,
      bodyText:
        `Demonstration data, thread ${index + 1}. Organising our weekly game is a nightmare. ` +
        'Everyone uses a different chat app and nobody replies to the poll. We use a free group chat and a spreadsheet.',
      url: `https://demo-club-forum-${index + 1}.invalid/thread`,
      signalTypeKey: 'pain',
      evidenceClass: 'community',
      observedAt: now,
      demo: true,
    });
    await attachEvidence(deps, ctx, loud.id, {
      evidenceUnitId: recorded.evidenceUnitId,
      stance: 'for',
    });
  }
  await rescoreOpportunity(deps, ctx, loud.id, { cause: 'new_evidence' });

  // ------------------------------------- one rejected, and watching for change
  const rejected = await createOpportunity(deps, ctx, {
    title: 'DEMO automated stock counting for small warehouses',
    thesis: 'Counting stock by hand is slow, so an automated count should sell.',
    typeKey: 'new_product',
    problemStatement: 'Counting stock by hand takes two people a full day every month.',
    demo: true,
  });

  const stockEvidence = await recordSignal(deps, ctx, {
    title: 'DEMO operator describes counting stock by hand',
    bodyText:
      'Demonstration data. Counting stock takes two of us a full day every month, but the hardware to automate it costs more than the day does.',
    url: 'https://demo-warehouse-forum.invalid/stock',
    signalTypeKey: 'labour',
    evidenceClass: 'direct_customer',
    observedAt: now,
    demo: true,
  });
  await attachEvidence(deps, ctx, rejected.id, {
    evidenceUnitId: stockEvidence.evidenceUnitId,
    stance: 'for',
  });
  await rescoreOpportunity(deps, ctx, rejected.id, { cause: 'new_evidence' });

  await transitionOpportunity(deps, ctx, rejected.id, {
    toState: 'rejected',
    reason:
      'The hardware costs more than the labour it replaces, and nobody in the evidence has paid for a fix.',
  });

  await createTrigger(deps, ctx, rejected.id, {
    kind: 'cost_collapse',
    description: 'Scanning hardware becomes cheap enough to change the arithmetic.',
    predicate: {
      signalTypes: ['cost_collapse', 'technology_unlock'],
      anyOf: ['scanning', 'stock', 'inventory'],
      requireIndependent: true,
    },
  });

  // --------------------------------------------- a little execution history
  for (const [index, outcome] of (['succeeded', 'shipped_and_used', 'failed'] as const).entries()) {
    await recordExecutionOutcome(deps, ctx, {
      outcome,
      predictedBuildDays: 10,
      actualBuildDays: 14 + index,
      reason: `DEMO past project ${index + 1}`,
      source: 'demo',
    });
  }

  await c.db.close();

  process.stdout.write(
    [
      'opportunity-radar: demo workspace seeded.',
      `  sign in as ${EMAIL} with the password ${PASSWORD}`,
      '  every seeded object is flagged demo and shows a DEMO badge.',
      '  calibration will refuse to adjust anything: three outcomes is not eight.',
      '',
    ].join('\n'),
  );
}

await main();
