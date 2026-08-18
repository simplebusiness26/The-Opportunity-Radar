import type { RelationshipKind } from '../../domain/memory/relationships';
import type { TriggerPredicate } from '../../domain/memory/triggers';

export interface TriggerRow {
  id: string;
  workspaceId: string;
  opportunityId: string;
  kind: string;
  description: string;
  predicate: TriggerPredicate;
  active: boolean;
  lastCheckedAt: Date | null;
  firedAt: Date | null;
  firedSignalId: string | null;
  checkCount: number;
  createdAt: Date;
}

export interface TriggerRepository {
  create(
    workspaceId: string,
    input: {
      opportunityId: string;
      kind: string;
      description: string;
      predicate: TriggerPredicate;
    },
  ): Promise<TriggerRow>;
  listFor(workspaceId: string, opportunityId: string): Promise<TriggerRow[]>;
  /** Every armed trigger in the workspace, for evaluating new evidence against. */
  listActive(workspaceId: string, limit?: number): Promise<TriggerRow[]>;
  /** Records that a trigger was evaluated, whether or not it fired. */
  markChecked(triggerIds: string[], at: Date): Promise<void>;
  fire(triggerId: string, input: { signalId: string | null; at: Date }): Promise<void>;
  deactivate(workspaceId: string, triggerId: string): Promise<void>;
}

export interface RelationshipRow {
  id: string;
  workspaceId: string;
  fromOpportunityId: string;
  toOpportunityId: string;
  kind: RelationshipKind;
  note: string | null;
  assertedBy: string;
  createdAt: Date;
}

export interface RelationshipRepository {
  link(
    workspaceId: string,
    input: {
      fromOpportunityId: string;
      toOpportunityId: string;
      kind: RelationshipKind;
      note?: string | null;
      assertedBy: string;
      createdByUserId?: string | null;
      evidence?: Record<string, unknown>;
    },
  ): Promise<RelationshipRow>;
  unlink(workspaceId: string, relationshipId: string): Promise<void>;
  /** Both directions, so a page can show what points at this as well. */
  listFor(
    workspaceId: string,
    opportunityId: string,
  ): Promise<Array<RelationshipRow & { direction: 'from' | 'to'; otherTitle: string; otherReference: number; otherState: string }>>;
  listAll(workspaceId: string, limit?: number): Promise<RelationshipRow[]>;
}
