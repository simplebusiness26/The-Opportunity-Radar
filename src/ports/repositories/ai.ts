import type { AiRole } from '../../domain/budget/index';

export interface AiProviderRow {
  id: string;
  workspaceId: string;
  kind: 'openai' | 'anthropic' | 'gemini' | 'openai_compatible' | 'fixture';
  label: string;
  baseUrl: string | null;
  secretId: string | null;
  enabled: boolean;
  health: Record<string, unknown>;
}

export interface AiModelRow {
  id: string;
  providerId: string;
  modelKey: string;
  label: string;
  inputCostPerMtok: number | null;
  outputCostPerMtok: number | null;
  contextWindow: number | null;
  maxOutput: number | null;
  enabled: boolean;
}

export interface AiRouteRow {
  role: AiRole;
  primaryModelId: string | null;
  fallbackModelId: string | null;
  degradedModelId: string | null;
  maxOutputTokens: number;
  temperature: number;
}

export interface AiCallRecord {
  role: AiRole;
  providerId: string | null;
  modelId: string | null;
  modelKey: string;
  promptKey?: string | null;
  promptVersion?: string | null;
  schemaKey?: string | null;
  schemaVersion?: string | null;
  jobId?: string | null;
  runId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  requestHash: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  costEstimated: boolean;
  latencyMs: number | null;
  status: 'ok' | 'repaired' | 'invalid_output' | 'error' | 'refused' | 'blocked_by_budget';
  attempt: number;
  errorCode?: string | null;
  injectionAttempts?: string[];
}

export interface AiRepository {
  listProviders(workspaceId: string): Promise<AiProviderRow[]>;
  countEnabled(workspaceId?: string): Promise<number>;
  upsertProvider(
    workspaceId: string,
    input: { kind: AiProviderRow['kind']; label: string; baseUrl?: string | null; secretId?: string | null; enabled?: boolean },
  ): Promise<AiProviderRow>;
  setProviderHealth(providerId: string, health: Record<string, unknown>): Promise<void>;
  upsertModel(
    workspaceId: string,
    providerId: string,
    input: { modelKey: string; label: string; inputCostPerMtok?: number | null; outputCostPerMtok?: number | null; contextWindow?: number | null; maxOutput?: number | null; enabled?: boolean },
  ): Promise<AiModelRow>;
  listModels(workspaceId: string): Promise<AiModelRow[]>;
  findModel(workspaceId: string, modelId: string): Promise<AiModelRow | null>;
  routes(workspaceId: string): Promise<AiRouteRow[]>;
  setRoute(
    workspaceId: string,
    role: AiRole,
    input: { primaryModelId?: string | null; fallbackModelId?: string | null; degradedModelId?: string | null; maxOutputTokens?: number; temperature?: number },
  ): Promise<void>;

  recordCall(workspaceId: string, record: AiCallRecord, now: Date): Promise<{ id: string }>;
  savePayload(aiCallId: string, request: unknown, response: unknown): Promise<void>;
  spendSummary(
    workspaceId: string,
    since: Date,
  ): Promise<Array<{ role: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>>;
  spendBySubject(
    workspaceId: string,
    subjectType: string,
    since: Date,
  ): Promise<Array<{ subjectId: string | null; calls: number; costUsd: number }>>;
  recentCalls(workspaceId: string, limit?: number): Promise<Array<AiCallRecord & { id: string; createdAt: Date }>>;
}

export interface BudgetRow {
  period: 'daily' | 'monthly';
  limitUsd: number;
  warnPct: number;
  degradePct: number;
  criticalPct: number;
  enabled: boolean;
}

export interface LedgerRow {
  periodKey: string;
  period: 'daily' | 'monthly';
  spentUsd: number;
  reservedUsd: number;
}

export interface BudgetRepository {
  listBudgets(workspaceId: string): Promise<BudgetRow[]>;
  setBudget(
    workspaceId: string,
    input: { period: 'daily' | 'monthly'; limitUsd: number; warnPct?: number; degradePct?: number; criticalPct?: number; enabled?: boolean },
  ): Promise<void>;
  ledger(workspaceId: string, periodKeys: string[]): Promise<LedgerRow[]>;

  /**
   * Reserves an amount against every named period atomically.
   *
   * Returns false when any period lacks the headroom, having reserved nothing.
   * This is what makes the limit hold under concurrent callers: the check and
   * the reservation are one statement, so two calls cannot both pass the same
   * remaining balance.
   */
  reserve(
    workspaceId: string,
    input: { periods: Array<{ key: string; period: 'daily' | 'monthly'; limitUsd: number }>; amountUsd: number; expiresAt: Date },
  ): Promise<{ ok: boolean; reservationId: string | null }>;

  /** Converts a reservation into actual spend. */
  settle(
    reservationId: string,
    input: { actualUsd: number; aiCallId: string | null },
  ): Promise<void>;

  /** Releases a reservation whose call never happened. */
  release(reservationId: string): Promise<void>;

  /**
   * Releases reservations whose owner crashed. Until swept they count as spent,
   * because failing closed is the only safe direction for money.
   */
  sweepExpired(now: Date): Promise<number>;
}
