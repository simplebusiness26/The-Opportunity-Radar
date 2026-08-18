import type { SourceCategory } from '../source-adapter';

export type SourceStatus = 'ok' | 'degraded' | 'failing' | 'not_configured' | 'disabled';

export interface SourceRow {
  id: string;
  workspaceId: string;
  adapterKey: string;
  name: string;
  category: SourceCategory;
  config: Record<string, string>;
  secretId: string | null;
  enabled: boolean;
  reliabilityTier: number;
  pollIntervalSec: number;
  maxItemsPerRun: number;
}

export interface SourceStateRow {
  sourceId: string;
  cursor: string | null;
  status: SourceStatus;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  backoffUntil: Date | null;
  lastMessage: string | null;
  lastRemedy: string | null;
  itemsLastRun: number;
}

export interface SourceRepository {
  create(
    workspaceId: string,
    input: {
      adapterKey: string;
      name: string;
      category: SourceCategory;
      config?: Record<string, string>;
      secretId?: string | null;
      enabled?: boolean;
      pollIntervalSec?: number;
      maxItemsPerRun?: number;
    },
  ): Promise<SourceRow>;
  update(
    workspaceId: string,
    sourceId: string,
    patch: Partial<Pick<SourceRow, 'name' | 'config' | 'enabled' | 'pollIntervalSec' | 'maxItemsPerRun'>>,
    now: Date,
  ): Promise<void>;
  findById(workspaceId: string, sourceId: string): Promise<SourceRow | null>;
  list(workspaceId: string, options?: { enabledOnly?: boolean }): Promise<SourceRow[]>;
  remove(workspaceId: string, sourceId: string): Promise<void>;
  countEnabled(workspaceId?: string): Promise<number>;

  /** Sources due a run, honouring their interval and any backoff. */
  listDue(now: Date, limit?: number): Promise<SourceRow[]>;

  state(sourceId: string): Promise<SourceStateRow | null>;
  statesFor(workspaceId: string): Promise<SourceStateRow[]>;
  recordRun(
    sourceId: string,
    input: {
      status: SourceStatus;
      cursor?: string | null;
      message: string;
      remedy?: string | null;
      itemsFetched: number;
      durationMs?: number;
      succeeded: boolean;
      backoffUntil?: Date | null;
    },
    now: Date,
  ): Promise<void>;

  recordFetch(
    workspaceId: string,
    input: {
      sourceId: string | null;
      runId?: string | null;
      url: string;
      finalUrl?: string | null;
      httpStatus?: number | null;
      contentHash?: string | null;
      bytes?: number;
      hops?: unknown;
      robotsDecision?: string | null;
      blockedReason?: string | null;
    },
    now: Date,
  ): Promise<void>;

  recentFetches(workspaceId: string, limit?: number): Promise<Array<{ url: string; httpStatus: number | null; blockedReason: string | null; fetchedAt: Date }>>;
}
