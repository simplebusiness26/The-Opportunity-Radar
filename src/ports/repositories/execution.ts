export interface HandoffRow {
  id: string;
  workspaceId: string;
  opportunityId: string;
  status: 'prepared' | 'delivering' | 'delivered' | 'failed' | 'acknowledged' | 'completed';
  brief: Record<string, unknown>;
  briefMarkdown: string;
  target: string | null;
  externalRef: string | null;
  attempts: number;
  lastError: string | null;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

export interface HandoffRepository {
  create(
    workspaceId: string,
    input: {
      opportunityId: string;
      brief: Record<string, unknown>;
      briefMarkdown: string;
      target: string | null;
      createdByUserId?: string | null;
    },
  ): Promise<HandoffRow>;
  findById(workspaceId: string, id: string): Promise<HandoffRow | null>;
  /** Used to correlate feedback from the receiving system. */
  findByExternalRef(workspaceId: string, externalRef: string): Promise<HandoffRow | null>;
  /**
   * The one deliberately unscoped lookup in the product.
   *
   * The feedback endpoint is called by another system holding a bearer token
   * and an unguessable handoff id; it has no way to know which workspace the
   * work belongs to, and requiring it to would be an obstacle with no security
   * value. Named so that every use is obvious in review, and used nowhere
   * except that endpoint, which derives the workspace from the row it finds
   * rather than from anything the caller said.
   */
  findAcrossWorkspaces(input: { id?: string; externalRef?: string }): Promise<HandoffRow | null>;
  list(workspaceId: string, options?: { opportunityId?: string; limit?: number }): Promise<HandoffRow[]>;
  markDelivering(handoffId: string, now: Date): Promise<void>;
  markDelivered(handoffId: string, input: { externalRef: string | null }, now: Date): Promise<void>;
  markFailed(handoffId: string, error: string, now: Date): Promise<void>;
  markAcknowledged(handoffId: string, now: Date): Promise<void>;
  markCompleted(handoffId: string, now: Date): Promise<void>;
}
