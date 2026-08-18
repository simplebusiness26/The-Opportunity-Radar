import type { Maturity, ReuseReadiness } from '../../domain/leverage/index';

export type IgNodeKind =
  | 'person'
  | 'skill'
  | 'project'
  | 'repo'
  | 'capability'
  | 'asset'
  | 'infrastructure'
  | 'knowledge'
  | 'resource'
  | 'constraint'
  | 'goal'
  | 'audience';

export type IgEdgeKind =
  | 'has_skill'
  | 'owns'
  | 'uses'
  | 'depends_on'
  | 'provides_capability'
  | 'reusable_for'
  | 'constrains'
  | 'supports_goal'
  | 'derived_from'
  | 'reaches';

export interface IgNodeRow {
  id: string;
  workspaceId: string;
  kind: IgNodeKind;
  name: string;
  matchKey: string;
  summary: string | null;
  source: 'manual' | 'github' | 'document' | 'derived';
  confidence: number;
  attrs: Record<string, unknown>;
  verifiedAt: Date | null;
  demo: boolean;
}

export interface CapabilityRow {
  nodeId: string;
  name: string;
  taxonomyKey: string;
  maturity: Maturity;
  evidenceStrength: number;
  lastVerifiedAt: Date | null;
  notes: string | null;
  /** Assets that provide it, resolved through the graph. */
  assetNames: string[];
  /** Readiness of the readiest providing asset, or null when none is recorded. */
  reuseReadiness: ReuseReadiness | null;
}

export interface AssetRow {
  nodeId: string;
  name: string;
  assetKind: string;
  reuseReadiness: ReuseReadiness;
  licence: string | null;
  sizeEstimate: string | null;
  lastChangeAt: Date | null;
  location: string | null;
}

export interface ResourceRow {
  nodeId: string;
  name: string;
  resourceKind: 'budget' | 'time' | 'compute' | 'team';
  amount: number;
  unit: string;
  period: string;
  committed: number;
}

export interface GoalRow {
  nodeId: string;
  name: string;
  horizon: string;
  priority: number;
  metric: string | null;
  target: string | null;
  weightHints: Record<string, number>;
}

export interface ConstraintRow {
  nodeId: string;
  name: string;
  constraintKind: string;
  hard: boolean;
  expression: Record<string, unknown>;
  description: string;
}

export interface GraphRepository {
  upsertNode(
    workspaceId: string,
    input: {
      kind: IgNodeKind;
      name: string;
      summary?: string | null;
      source?: IgNodeRow['source'];
      confidence?: number;
      attrs?: Record<string, unknown>;
      verifiedAt?: Date | null;
      demo?: boolean;
    },
  ): Promise<IgNodeRow>;
  findNode(workspaceId: string, nodeId: string): Promise<IgNodeRow | null>;
  listNodes(workspaceId: string, kinds?: IgNodeKind[]): Promise<IgNodeRow[]>;
  deleteNode(workspaceId: string, nodeId: string): Promise<void>;

  connect(
    workspaceId: string,
    input: { fromNodeId: string; toNodeId: string; kind: IgEdgeKind; weight?: number; evidence?: Record<string, unknown> },
  ): Promise<void>;
  disconnect(workspaceId: string, fromNodeId: string, toNodeId: string, kind: IgEdgeKind): Promise<void>;
  edgesFor(workspaceId: string, nodeId: string): Promise<Array<{ fromNodeId: string; toNodeId: string; kind: IgEdgeKind; weight: number }>>;

  setCapability(
    workspaceId: string,
    nodeId: string,
    input: { taxonomyKey: string; maturity: Maturity; evidenceStrength?: number; notes?: string | null; lastVerifiedAt?: Date | null },
  ): Promise<void>;
  listCapabilities(workspaceId: string): Promise<CapabilityRow[]>;

  setAsset(
    workspaceId: string,
    nodeId: string,
    input: { assetKind: string; reuseReadiness: ReuseReadiness; licence?: string | null; sizeEstimate?: string | null; location?: string | null; lastChangeAt?: Date | null },
  ): Promise<void>;
  listAssets(workspaceId: string): Promise<AssetRow[]>;

  setResource(
    workspaceId: string,
    nodeId: string,
    input: { resourceKind: ResourceRow['resourceKind']; amount: number; unit: string; period?: string; committed?: number },
  ): Promise<void>;
  listResources(workspaceId: string): Promise<ResourceRow[]>;

  setGoal(
    workspaceId: string,
    nodeId: string,
    input: { horizon?: string; priority?: number; metric?: string | null; target?: string | null; weightHints?: Record<string, number> },
  ): Promise<void>;
  listGoals(workspaceId: string): Promise<GoalRow[]>;

  setConstraint(
    workspaceId: string,
    nodeId: string,
    input: { constraintKind: string; hard: boolean; expression?: Record<string, unknown>; description: string },
  ): Promise<void>;
  listConstraints(workspaceId: string): Promise<ConstraintRow[]>;
}

export interface ExecutionHistoryRow {
  id: string;
  workspaceId: string;
  opportunityId: string | null;
  predictedBuildDays: number | null;
  actualBuildDays: number | null;
  predictedCost: number | null;
  actualCost: number | null;
  predictedConfidence: number | null;
  predictedScore: number | null;
  actualRevenue: number | null;
  outcome: string;
  reason: string | null;
  notes: string | null;
  source: string;
  recordedAt: Date;
}

export interface ExecutionHistoryRepository {
  record(
    workspaceId: string,
    input: Omit<ExecutionHistoryRow, 'id' | 'workspaceId' | 'recordedAt'> & { recordedByUserId?: string | null },
  ): Promise<ExecutionHistoryRow>;
  list(workspaceId: string, limit?: number): Promise<ExecutionHistoryRow[]>;
  forOpportunity(workspaceId: string, opportunityId: string): Promise<ExecutionHistoryRow[]>;
}
