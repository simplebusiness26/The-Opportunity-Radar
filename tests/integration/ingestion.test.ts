import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { addSource, listSourcesWithHealth } from '../../src/application/sources/manage';
import { ingestSource } from '../../src/application/sources/ingest';
import { ADAPTER_REGISTRY } from '../../src/adapters/sources/registry';
import { createSecretBox } from '../../src/adapters/crypto/secret-box';
import { createRecordedFetcher } from '../unit/helpers/recorded-fetcher';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';
import type { WorkspaceCtx } from '../../src/domain/types/identity';

const NOW = new Date('2026-08-18T00:00:00Z');
const KEY = Buffer.alloc(32, 7).toString('base64');

async function setup(fetcher: ReturnType<typeof createRecordedFetcher>) {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);

  const deps = {
    repos: createRepositories(db),
    tx: createTransactor(db),
    clock,
    http: fetcher,
    adapters: ADAPTER_REGISTRY,
    secretBox: createSecretBox(KEY),
    userAgent: 'OpportunityRadar/1.0 (test)',
  };

  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };

  return { deps, ctx, clock };
}

describe('ingesting from a source', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('turns fetched items into evidence, counting new against repeat', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'hacker_news',
      name: 'HN: booking deposits',
      config: { query: 'booking deposit' },
    });

    const first = await ingestSource(deps, ctx, sourceId);

    expect(first.status).toBe('ok');
    expect(first.itemsSeen).toBe(2);
    expect(first.newEvidence).toBe(2);

    // The same fetch again is a repeat, not new corroboration. Counting it
    // twice is precisely the error the product exists to avoid.
    const second = await ingestSource(deps, ctx, sourceId);
    expect(second.itemsSeen).toBe(2);
    expect(second.newEvidence).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(second.message).toContain('Repetition is not corroboration');
  });

  it('treats a re-read of the same source item as one observation, not two', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'hacker_news',
      name: 'HN',
      config: { query: 'x' },
    });

    // Sources are polled repeatedly by design. Re-reading an item is the same
    // observation seen again -- not a new mention, and certainly not new
    // evidence. Counting it would let polling frequency manufacture support.
    await ingestSource(deps, ctx, sourceId);
    await ingestSource(deps, ctx, sourceId);
    await ingestSource(deps, ctx, sourceId);

    const { rows, total } = await deps.repos.signals.list(ctx.workspaceId, { limit: 50 });
    expect(total).toBe(2);

    const units = await deps.repos.evidence.listByIds(
      ctx.workspaceId,
      rows.map((row) => row.evidenceUnitId!).filter(Boolean),
    );
    for (const unit of units) {
      expect(unit.mentionCount).toBe(1);
    }
  });

  it('records provenance for every item it kept', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'hacker_news',
      name: 'HN',
      config: { query: 'x' },
    });
    await ingestSource(deps, ctx, sourceId);

    const fetches = await deps.repos.sources.recentFetches(ctx.workspaceId, 10);
    expect(fetches.length).toBeGreaterThanOrEqual(2);
    // A claim can be traced back to the exact request that produced it.
    expect(fetches[0]?.url).toContain('http');
  });

  it('extracts the spending evidence that scoring leans on', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'hacker_news',
      name: 'HN',
      config: { query: 'x' },
    });
    await ingestSource(deps, ctx, sourceId);

    const { rows } = await deps.repos.signals.list(ctx.workspaceId, { limit: 10 });
    const spending = rows.find((row) => row.signalTypeKey === 'spending');

    expect(spending).toBeDefined();
    expect(spending?.monetaryEvidence.monthlyAmount).toBe(180);
  });

  it('holds an unconfigured source rather than reporting a failure', async () => {
    const fetcher = createRecordedFetcher([]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId, configWarning } = await addSource(deps, ctx, {
      adapterKey: 'reddit',
      name: 'Reddit, half set up',
      config: { subreddits: 'restaurateur' },
    });

    // Created despite being incomplete: losing a half-finished setup is worse
    // than showing it as incomplete.
    expect(configWarning).toContain('reddit.com/prefs/apps');

    const result = await ingestSource(deps, ctx, sourceId);
    expect(result.status).toBe('not_configured');
    expect(result.remedy).toContain('reddit.com/prefs/apps');

    const [view] = await listSourcesWithHealth(deps, ctx);
    expect(view?.status).toBe('not_configured');
  });

  it('backs a failing source off instead of hammering it', async () => {
    const fetcher = createRecordedFetcher([
      { match: 'broken.example', body: 'server error', status: 500 },
    ]);
    const { deps, ctx, clock } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'rss',
      name: 'A broken feed',
      config: { feedUrl: 'https://broken.example/feed.xml' },
    });

    const first = await ingestSource(deps, ctx, sourceId);
    expect(first.status).toBe('degraded');
    expect(first.remedy).toContain('Retrying in');

    // While backed off it is not offered as due, so one broken source cannot
    // consume every run.
    const due = await deps.repos.sources.listDue(clock.now(), 10);
    expect(due.map((source) => source.id)).not.toContain(sourceId);
  });

  it('escalates to failing after repeated failures', async () => {
    const fetcher = createRecordedFetcher([
      { match: 'broken.example', body: 'server error', status: 500 },
    ]);
    const { deps, ctx, clock } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'rss',
      name: 'A broken feed',
      config: { feedUrl: 'https://broken.example/feed.xml' },
    });

    let status = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      status = (await ingestSource(deps, ctx, sourceId)).status;
      clock.advance(6 * 60 * 60 * 1000);
    }

    expect(status).toBe('failing');
    const [view] = await listSourcesWithHealth(deps, ctx);
    expect(view?.consecutiveFailures).toBeGreaterThanOrEqual(3);
  });

  it('recovers cleanly once a source starts working again', async () => {
    const routes = [{ match: 'flaky.example', body: 'error', status: 500 }];
    const fetcher = createRecordedFetcher(routes);
    const { deps, ctx, clock } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'rss',
      name: 'A flaky feed',
      config: { feedUrl: 'https://flaky.example/feed.xml' },
    });

    await ingestSource(deps, ctx, sourceId);
    routes[0] = { match: 'flaky.example', file: 'feed.xml' } as never;

    clock.advance(60 * 60 * 1000);
    const recovered = await ingestSource(deps, ctx, sourceId);

    expect(recovered.status).toBe('ok');
    const [view] = await listSourcesWithHealth(deps, ctx);
    expect(view?.consecutiveFailures).toBe(0);
    expect(view?.status).toBe('ok');
  });

  it('stores a credential encrypted and never in the source row', async () => {
    const fetcher = createRecordedFetcher([]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'github',
      name: 'GitHub issues',
      config: { query: 'deposit', token: 'ghp_secret_value' },
    });

    const source = await deps.repos.sources.findById(ctx.workspaceId, sourceId);
    expect(JSON.stringify(source?.config)).not.toContain('ghp_secret_value');
    expect(source?.secretId).toBeTruthy();

    // It is recoverable for the adapter, but only through the sealed store.
    const sealed = await deps.repos.secrets.find(source!.secretId!);
    expect(deps.secretBox.open(sealed!)).toBe('ghp_secret_value');
  });

  it('respects the scan depth the budget governor asks for', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const { deps, ctx } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'hacker_news',
      name: 'HN',
      config: { query: 'x' },
      maxItemsPerRun: 50,
    });

    await ingestSource({ ...deps, scanDepthFactor: 0.5 }, ctx, sourceId);
    expect(fetcher.requests[0]?.url).toContain('hitsPerPage=25');
  });

  it('records what the run actually did, for the machine view', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const { deps, ctx, clock } = await setup(fetcher);

    const { sourceId } = await addSource(deps, ctx, {
      adapterKey: 'hacker_news',
      name: 'HN',
      config: { query: 'x' },
    });
    await ingestSource(deps, ctx, sourceId);

    const summary = await deps.repos.runStats.summary(
      ctx.workspaceId,
      new Date(clock.now().getTime() - 86_400_000),
    );
    const ingest = summary.find((entry) => entry.kind === 'ingest');

    expect(ingest?.itemsSeen).toBe(2);
    expect(ingest?.itemsRetained).toBe(2);
  });
});
