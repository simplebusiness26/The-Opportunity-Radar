import type { OpportunityState } from '../../domain/state/opportunity-state';
import type { OpportunityTypeKey } from '../../domain/taxonomy/opportunity-types';
import type { ScoreResult } from '../../domain/scoring/engine';
import type { ScoringInput } from '../../domain/scoring/types';

export interface ClusterRow {
  id: string;
  workspaceId: string;
  title: string;
  problemStatement: string;
  targetCustomer: string | null;
  status: 'new' | 'watching' | 'investigating' | 'promoted' | 'dormant' | 'merged';
  rawMentions: number;
  uniqueEvidenceCount: number;
  independentSourceCount: number;
  sourceDiversity: number;
  momentum30d: number | null;
  confidence: number;
  firstSeenAt: Date;
  lastEvidenceAt: Date;
  demo: boolean;
}

export interface ClusterRepository {
  create(
    workspaceId: string,
    input: {
      title: string;
      problemStatement: string;
      targetCustomer?: string | null;
      createdByUserId?: string | null;
      observedAt: Date;
      demo?: boolean;
    },
  ): Promise<ClusterRow>;
  findById(workspaceId: string, id: string): Promise<ClusterRow | null>;
  list(
    workspaceId: string,
    options?: { status?: ClusterRow['status'][]; includeDemo?: boolean; limit?: number },
  ): Promise<ClusterRow[]>;
  addMember(clusterId: string, evidenceUnitId: string, addedBy: string): Promise<void>;
  removeMember(clusterId: string, evidenceUnitId: string, at: Date): Promise<void>;
  memberEvidenceIds(clusterId: string): Promise<string[]>;
  updateMetrics(
    clusterId: string,
    metrics: {
      rawMentions: number;
      uniqueEvidenceCount: number;
      independentSourceCount: number;
      sourceDiversity: number;
      confidence: number;
      lastEvidenceAt: Date;
      momentum30d?: number | null;
    },
  ): Promise<void>;
  setStatus(clusterId: string, status: ClusterRow['status']): Promise<void>;
  /** Cluster shapes used to decide where new evidence belongs. */
  centroids(workspaceId: string): Promise<
    Array<{
      clusterId: string;
      embedding: Buffer | null;
      embeddingModel: string | null;
      title: string;
      problemStatement: string;
      entityKeys: string[];
    }>
  >;
  /** Clusters an evidence unit already belongs to, so joins stay idempotent. */
  clusterIdsForEvidence(workspaceId: string, evidenceUnitId: string): Promise<string[]>;
  setCentroid(clusterId: string, embedding: Buffer | null, embeddingModel: string | null): Promise<void>;
}

export interface OpportunityRow {
  id: string;
  workspaceId: string;
  clusterId: string | null;
  reference: number;
  title: string;
  thesis: string;
  typeKey: OpportunityTypeKey;
  state: OpportunityState;
  stateSince: Date;
  targetCustomer: string | null;
  problemStatement: string | null;
  whyNow: string | null;
  notes: Record<string, unknown>;
  ownerUserId: string | null;
  createdBy: string;
  demo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpportunityRepository {
  create(
    workspaceId: string,
    input: {
      clusterId?: string | null;
      title: string;
      thesis: string;
      typeKey: OpportunityTypeKey;
      targetCustomer?: string | null;
      problemStatement?: string | null;
      whyNow?: string | null;
      ownerUserId?: string | null;
      createdBy: string;
      demo?: boolean;
    },
  ): Promise<OpportunityRow>;
  findById(workspaceId: string, id: string): Promise<OpportunityRow | null>;
  findByReference(workspaceId: string, reference: number): Promise<OpportunityRow | null>;
  list(
    workspaceId: string,
    options?: { states?: OpportunityState[]; typeKeys?: OpportunityTypeKey[]; includeDemo?: boolean; limit?: number },
  ): Promise<OpportunityRow[]>;
  update(
    workspaceId: string,
    id: string,
    patch: Partial<Pick<OpportunityRow, 'title' | 'thesis' | 'typeKey' | 'targetCustomer' | 'problemStatement' | 'whyNow' | 'notes' | 'ownerUserId'>>,
    now: Date,
  ): Promise<OpportunityRow>;
  setState(id: string, state: OpportunityState, at: Date): Promise<void>;
  recordTransition(input: {
    opportunityId: string;
    fromState: OpportunityState | null;
    toState: OpportunityState;
    reason: string;
    actorKind: 'user' | 'system' | 'job';
    actorUserId: string | null;
    evidence?: Record<string, unknown>;
  }): Promise<void>;
  listTransitions(opportunityId: string): Promise<Array<{
    fromState: OpportunityState | null;
    toState: OpportunityState;
    reason: string;
    actorKind: string;
    evidence: Record<string, unknown>;
    createdAt: Date;
  }>>;
  attachEvidence(input: {
    opportunityId: string;
    evidenceUnitId: string;
    stance: 'for' | 'against';
    weight?: number;
    note?: string | null;
    addedBy: string;
  }): Promise<void>;
  detachEvidence(opportunityId: string, evidenceUnitId: string, stance: 'for' | 'against'): Promise<void>;
  evidenceFor(opportunityId: string): Promise<Array<{ evidenceUnitId: string; stance: 'for' | 'against'; weight: number; note: string | null }>>;
  nextReference(workspaceId: string): Promise<number>;
}

export interface ScoreRow {
  id: string;
  opportunityId: string;
  engineVersion: string;
  inputsDigest: string;
  attractiveness: number | null;
  fit: number | null;
  leverage: number | null;
  timing: number | null;
  validationEfficiency: number | null;
  strategicValue: number | null;
  executionRisk: number | null;
  confidence: number;
  dimensions: unknown;
  gaps: unknown;
  confidenceFactors: unknown;
  /** The frozen inputs this score was computed from, for provenance. */
  inputsSnapshot: unknown;
  computedAt: Date;
}

export interface ScoreRepository {
  save(
    workspaceId: string,
    opportunityId: string,
    input: { result: ScoreResult; snapshot: ScoringInput; profileId: string | null; computedAt: Date },
  ): Promise<ScoreRow>;
  current(workspaceId: string, opportunityId: string): Promise<ScoreRow | null>;
  history(workspaceId: string, opportunityId: string, limit?: number): Promise<ScoreRow[]>;
  currentForMany(workspaceId: string, opportunityIds: string[]): Promise<Map<string, ScoreRow>>;
  recordDeltas(
    workspaceId: string,
    opportunityId: string,
    input: {
      fromScoreId: string | null;
      toScoreId: string;
      cause: string;
      deltas: Array<{ composite: string; from: number | null; to: number | null; delta: number; topDrivers: unknown }>;
    },
  ): Promise<void>;
  recentDeltas(
    workspaceId: string,
    since: Date,
    limit?: number,
  ): Promise<Array<{ opportunityId: string; composite: string; fromValue: number | null; toValue: number | null; delta: number; topDrivers: unknown; cause: string; createdAt: Date }>>;
  activeWeights(workspaceId: string): Promise<{ profileId: string | null; weights: Record<string, number> }>;
}

export interface DecisionRepository {
  record(
    workspaceId: string,
    input: {
      subjectType: string;
      subjectId: string | null;
      decision: string;
      rationale: string;
      radarRecommendation?: string | null;
      radarConfidence?: number | null;
      actorUserId: string | null;
      context?: Record<string, unknown>;
    },
  ): Promise<void>;
  list(workspaceId: string, limit?: number): Promise<Array<{
    subjectType: string;
    subjectId: string | null;
    decision: string;
    rationale: string;
    radarRecommendation: string | null;
    radarConfidence: number | null;
    createdAt: Date;
  }>>;
}
