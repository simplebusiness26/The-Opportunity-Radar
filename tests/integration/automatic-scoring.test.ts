import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { createOpportunity } from '../../src/application/opportunities/lifecycle';
import { scoreUnscoredOpportunities } from '../../src/application/opportunities/auto-score';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import type { SystemCtx, WorkspaceCtx } from '../../src/domain/types/identity';
import { controllableClock } from '../../src/adapters/clock/index';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';

const NOW = new Date('2026-08-20T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const deps = { repos: createRepositories(db), tx: createTransactor(db), clock };
  const ownerCtx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };
  const systemCtx: SystemCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    actor: 'system',
  };

  return { deps, ownerCtx, systemCtx };
}

describe('automatic opportunity scoring', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('works through the unscored backlog in bounded batches and leaves existing scores alone', async () => {
    const { deps, ownerCtx, systemCtx } = await setup();
    const ids: string[] = [];

    for (let index = 0; index < 7; index += 1) {
      const opportunity = await createOpportunity(deps, ownerCtx, {
        title: `Opportunity ${index}`,
        thesis: `There may be a useful commercial opportunity number ${index} worth measuring before building.`,
        typeKey: 'new_product',
        problemStatement: `Customer problem number ${index} is still being evidenced.`,
      });
      ids.push(opportunity.id);
    }

    // One already has a score and must not be recomputed just because the
    // backlog heartbeat runs.
    await rescoreOpportunity(deps, ownerCtx, ids[0]!, { cause: 'manual' });

    const first = await scoreUnscoredOpportunities(deps, systemCtx, { limit: 3 });
    expect(first).toEqual({
      available: 6,
      attempted: 3,
      scored: 3,
      failed: 0,
      remaining: 3,
    });

    let scores = await deps.repos.scores.currentForMany(ownerCtx.workspaceId, ids);
    expect(scores.size).toBe(4);
    expect(scores.has(ids[0]!)).toBe(true);

    const second = await scoreUnscoredOpportunities(deps, systemCtx, { limit: 12 });
    expect(second.available).toBe(3);
    expect(second.scored).toBe(3);
    expect(second.failed).toBe(0);
    expect(second.remaining).toBe(0);

    scores = await deps.repos.scores.currentForMany(ownerCtx.workspaceId, ids);
    expect(scores.size).toBe(7);
  });
});
