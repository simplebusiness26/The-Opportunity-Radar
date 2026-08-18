export interface InvestigationRow {
  id: string;
  workspaceId: string;
  subjectType: string;
  subjectId: string;
  roleKey: string;
  state: 'queued' | 'running' | 'complete' | 'terminated' | 'failed' | 'blocked';
  spentUsd: number;
  terminationReason: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface InvestigationOutputRow {
  id: string;
  investigationId: string;
  schemaKey: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  promptVersion: string | null;
  aiCallId: string | null;
  projectionReport: Record<string, unknown>;
  createdAt: Date;
}

export interface InvestigationRepository {
  start(
    workspaceId: string,
    input: { subjectType: string; subjectId: string; roleKey: string; budgetCapUsd: number; jobId?: string | null },
    now: Date,
  ): Promise<InvestigationRow>;
  finish(
    investigationId: string,
    input: { state: InvestigationRow['state']; terminationReason: string; spentUsd: number },
    now: Date,
  ): Promise<void>;
  saveOutput(
    investigationId: string,
    input: {
      schemaKey: string;
      schemaVersion: string;
      payload: Record<string, unknown>;
      promptKey: string;
      promptVersion: string;
      aiCallId: string | null;
      projectionReport: Record<string, unknown>;
    },
  ): Promise<void>;
  completedRoles(workspaceId: string, subjectType: string, subjectId: string): Promise<string[]>;
  outputsFor(workspaceId: string, subjectType: string, subjectId: string): Promise<InvestigationOutputRow[]>;
  listFor(workspaceId: string, subjectType: string, subjectId: string): Promise<InvestigationRow[]>;
}

export interface UncertaintyRow {
  id: string;
  opportunityId: string;
  kind: 'known_fact' | 'assumption' | 'unknown' | 'critical_unknown' | 'evidence_gap';
  statement: string;
  impact: number;
  resolvability: number;
  costToResolve: number | null;
  daysToResolve: number | null;
  voiScore: number;
  status: 'open' | 'resolved' | 'unresolvable' | 'superseded';
  resolution: string | null;
}

export interface UncertaintyRepository {
  replaceFor(
    workspaceId: string,
    opportunityId: string,
    items: Array<Omit<UncertaintyRow, 'id' | 'opportunityId' | 'status' | 'resolution'>>,
  ): Promise<void>;
  listFor(workspaceId: string, opportunityId: string, options?: { openOnly?: boolean }): Promise<UncertaintyRow[]>;
  resolve(workspaceId: string, itemId: string, resolution: string): Promise<void>;
  countCritical(workspaceId: string, opportunityId: string): Promise<number>;
}

export interface ValidationPlanRow {
  id: string;
  opportunityId: string;
  hypothesis: string;
  whyItMatters: string;
  experimentType: string;
  audience: string;
  steps: string[];
  estimatedCost: number;
  estimatedDays: number;
  successThreshold: { description: string; metric: string; value: number };
  failureThreshold: { description: string; metric: string; value: number };
  evidenceToCollect: string[];
  doNotBuildYet: string[];
  createdAt: Date;
}

export interface ExperimentRow {
  id: string;
  workspaceId: string;
  opportunityId: string;
  validationPlanId: string | null;
  name: string;
  state: 'proposed' | 'approved' | 'running' | 'blocked' | 'completed' | 'abandoned';
  stateSince: Date;
  verdict: 'validated' | 'partially_validated' | 'inconclusive' | 'rejected' | null;
  budget: number;
  actualCost: number;
  conclusion: string | null;
  demo: boolean;
}

export interface ValidationRepository {
  savePlan(
    workspaceId: string,
    opportunityId: string,
    input: Omit<ValidationPlanRow, 'id' | 'opportunityId' | 'createdAt'> & {
      riskiestAssumptionId?: string | null;
      createdByUserId?: string | null;
    },
  ): Promise<ValidationPlanRow>;
  latestPlan(workspaceId: string, opportunityId: string): Promise<ValidationPlanRow | null>;

  createExperiment(
    workspaceId: string,
    input: { opportunityId: string; validationPlanId: string | null; name: string; budget: number; ownerUserId?: string | null; demo?: boolean },
    now: Date,
  ): Promise<ExperimentRow>;
  findExperiment(workspaceId: string, experimentId: string): Promise<ExperimentRow | null>;
  listExperiments(workspaceId: string, options?: { opportunityId?: string; limit?: number }): Promise<ExperimentRow[]>;
  transitionExperiment(
    experimentId: string,
    input: { fromState: string | null; toState: string; reason: string; actorKind: string; actorUserId: string | null; verdict?: string | null; conclusion?: string | null },
    now: Date,
  ): Promise<void>;
  recordResult(
    experimentId: string,
    input: { metricKey: string; value: number; unit?: string | null; notes?: string | null; recordedByUserId?: string | null },
    now: Date,
  ): Promise<void>;
  resultsFor(experimentId: string): Promise<Array<{ metricKey: string; value: number; unit: string | null; notes: string | null }>>;
  recordContact(
    experimentId: string,
    input: { label: string; outcome: string; notes?: string | null },
    now: Date,
  ): Promise<void>;
  contactsFor(experimentId: string): Promise<Array<{ label: string; outcome: string; notes: string | null }>>;
}
