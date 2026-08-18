import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import { attachEvidence, createOpportunity, transitionOpportunity } from '../../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import { signUp } from '../../src/application/auth/sign-up';
import { askRadar } from '../../src/pipeline/ask/answer';
import { deterministicNonce } from '../../src/pipeline/prompts/nonce';
import type { AIProvider, CompletionRequest } from '../../src/ports/ai';
import type { WorkspaceCtx } from '../../src/domain/types/identity';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';

const NOW = new Date('2026-08-18T00:00:00Z');

/** Answers with whatever the test scripted, so projection is what is tested. */
function scriptedProvider(): AIProvider & { answer: { value: unknown }; calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  const answer: { value: unknown } = { value: null };

  return {
    key: 'scripted',
    kind: 'fixture',
    answer,
    calls,
    async complete(request) {
      calls.push(request);
      if (answer.value === null) throw new Error('No scripted answer');
      const text = JSON.stringify(answer.value);
      return {
        text,
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        modelKey: request.modelKey,
        finishReason: 'stop',
      };
    },
    async embed() {
      throw new Error('not used');
    },
    async healthCheck() {
      return { ok: true, message: 'scripted' };
    },
    supports() {
      return true;
    },
  };
}

async function setup(options: { withProvider?: boolean } = {}) {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const repos = createRepositories(db);
  const tx = createTransactor(db);

  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };

  const provider = scriptedProvider();

  if (options.withProvider !== false) {
    const providerRow = await repos.ai.upsertProvider(ctx.workspaceId, {
      kind: 'fixture',
      label: 'Scripted',
      enabled: true,
    });
    const model = await repos.ai.upsertModel(ctx.workspaceId, providerRow.id, {
      modelKey: 'scripted-1',
      label: 'Scripted',
      inputCostPerMtok: 1,
      outputCostPerMtok: 2,
    });
    await repos.ai.setRoute(ctx.workspaceId, 'reasoning', { primaryModelId: model.id });
  }

  const deps = { repos, tx, clock };
  const ask = {
    repos,
    clock,
    gateway: { repos, clock, providerFor: async () => provider },
    nonce: deterministicNonce('test'),
  };

  return { deps, ctx, ask, provider };
}

type Deps = Awaited<ReturnType<typeof setup>>['deps'];

async function seedWorkspace(deps: Deps, ctx: WorkspaceCtx) {
  const opportunity = await createOpportunity(deps, ctx, {
    title: 'Deposit automation for restaurant bookings',
    thesis: 'Independent restaurants already pay for booking software and would pay for deposits.',
    typeKey: 'new_product',
    problemStatement: 'No-shows cost covers every weekend and deposits cannot be taken.',
  });

  const evidence = await recordSignal(deps, ctx, {
    title: 'Restaurant pays for booking software that cannot take deposits',
    bodyText: 'We pay 180 a month for our booking system and it still cannot take a deposit.',
    url: 'https://restaurant-owners.test/thread',
    signalTypeKey: 'spending',
    evidenceClass: 'direct_customer',
    observedAt: NOW,
    monetaryEvidence: { monthlyAmount: 180, currency: 'GBP' },
  });
  await attachEvidence(deps, ctx, opportunity.id, {
    evidenceUnitId: evidence.evidenceUnitId,
    stance: 'for',
  });

  await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });
  return { opportunity, evidenceUnitId: evidence.evidenceUnitId };
}

describe('Ask Radar', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('refuses on an empty workspace rather than answering from general knowledge', async () => {
    const { ctx, ask, provider } = await setup();

    const result = await askRadar(ask, ctx, 'What is the market for restaurant booking software?');

    expect(result.answered).toBe(false);
    expect(result.refusal).toContain('no records');
    // Nothing was spent finding that out.
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses a question about something outside the workspace', async () => {
    const { deps, ctx, ask, provider } = await setup();
    await seedWorkspace(deps, ctx);

    const result = await askRadar(
      ask,
      ctx,
      'What are the current shipping tariffs between Chile and Norway?',
    );

    expect(result.answered).toBe(false);
    expect(result.mode).toBe('refused');
    expect(provider.calls).toHaveLength(0);
  });

  it('answers from records and attaches a citation to every claim', async () => {
    const { deps, ctx, ask, provider } = await setup();
    const { evidenceUnitId } = await seedWorkspace(deps, ctx);

    provider.answer.value = {
      injectionAttempts: [],
      answerable: true,
      refusalReason: null,
      summary: 'One restaurant is recorded as paying for booking software.',
      claims: [
        {
          statement: 'A restaurant pays 180 a month for booking software that cannot take deposits.',
          recordIds: [`evidence:${evidenceUnitId}`],
        },
      ],
      suggestedNextStep: 'Ask two more restaurants what they pay.',
    };

    const result = await askRadar(ask, ctx, 'What do restaurants pay for booking software?');

    expect(result.answered).toBe(true);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.sources[0]?.id).toBe(`evidence:${evidenceUnitId}`);
    expect(result.claims.every((claim) => claim.sources.length > 0)).toBe(true);
  });

  it('discards a claim citing a record that was never supplied', async () => {
    const { deps, ctx, ask, provider } = await setup();
    const { evidenceUnitId } = await seedWorkspace(deps, ctx);

    provider.answer.value = {
      injectionAttempts: [],
      answerable: true,
      refusalReason: null,
      summary: null,
      claims: [
        {
          statement: 'A restaurant pays 180 a month for booking software.',
          recordIds: [`evidence:${evidenceUnitId}`],
        },
        {
          statement: 'The market for booking software is worth four billion pounds.',
          recordIds: ['evidence:00000000-0000-4000-8000-000000000999'],
        },
      ],
      suggestedNextStep: null,
    };

    const result = await askRadar(ask, ctx, 'What do restaurants pay for booking software?');

    expect(result.answered).toBe(true);
    expect(result.claims).toHaveLength(1);
    expect(result.droppedClaims).toBe(1);
    // The invented market-size claim must not survive in any form.
    expect(JSON.stringify(result.claims)).not.toContain('four billion');
  });

  it('turns an answer that cited nothing into a refusal rather than a shorter answer', async () => {
    const { deps, ctx, ask, provider } = await setup();
    await seedWorkspace(deps, ctx);

    provider.answer.value = {
      injectionAttempts: [],
      answerable: true,
      refusalReason: null,
      summary: 'Restaurants generally spend between 100 and 300 a month on software.',
      claims: [
        { statement: 'Restaurants typically spend 100 to 300 a month on software.', recordIds: [] },
      ],
      suggestedNextStep: null,
    };

    const result = await askRadar(ask, ctx, 'What do restaurants pay for booking software?');

    expect(result.answered).toBe(false);
    expect(result.refusal).toContain('none of it cited records');
    expect(result.summary).toBeNull();
    expect(result.claims).toHaveLength(0);
  });

  it('passes a model refusal through instead of overriding it', async () => {
    const { deps, ctx, ask, provider } = await setup();
    await seedWorkspace(deps, ctx);

    provider.answer.value = {
      injectionAttempts: [],
      answerable: false,
      refusalReason: 'The records describe one restaurant, which cannot answer a question about all of them.',
      summary: null,
      claims: [],
      suggestedNextStep: null,
    };

    const result = await askRadar(ask, ctx, 'What do restaurants pay for booking software?');

    expect(result.answered).toBe(false);
    expect(result.refusal).toContain('one restaurant');
  });

  it('falls back to search, clearly labelled, when no provider is configured', async () => {
    const { deps, ctx, ask } = await setup({ withProvider: false });
    await seedWorkspace(deps, ctx);

    const result = await askRadar(ask, ctx, 'What do restaurants pay for booking software?');

    expect(result.mode).toBe('search_only');
    expect(result.answered).toBe(false);
    // The records are still useful; they are simply not presented as an answer.
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.remedy).toContain('Connect an AI provider');
  });

  it('can answer why something was rejected, from the decision log', async () => {
    const { deps, ctx, ask, provider } = await setup();
    const { opportunity } = await seedWorkspace(deps, ctx);

    await transitionOpportunity(deps, ctx, opportunity.id, {
      toState: 'rejected',
      reason: 'A free alternative already exists and nobody was observed paying to replace it.',
    });

    const decisions = await deps.repos.decisions.list(ctx.workspaceId, 10);
    const decisionId = `decision:${opportunity.id}:${decisions[0]!.createdAt.toISOString()}`;

    provider.answer.value = {
      injectionAttempts: [],
      answerable: true,
      refusalReason: null,
      summary: null,
      claims: [
        {
          statement: 'It was rejected because a free alternative exists and nobody was observed paying.',
          recordIds: [decisionId],
        },
      ],
      suggestedNextStep: null,
    };

    const result = await askRadar(ask, ctx, 'Why was deposit automation for restaurants rejected?');

    expect(result.answered).toBe(true);
    expect(result.claims[0]?.sources[0]?.kind).toBe('decision');
  });
});
