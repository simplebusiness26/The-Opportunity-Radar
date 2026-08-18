import type { EvidenceClass } from '../../domain/taxonomy/evidence-class';
import type { SignalTypeKey } from '../../domain/taxonomy/signal-types';
import type { DedupeReason } from '../../domain/dedupe/cascade';

export interface SignalRow {
  id: string;
  workspaceId: string;
  sourceId: string | null;
  externalId: string | null;
  title: string;
  url: string | null;
  canonicalUrl: string | null;
  bodyText: string;
  authorHandle: string | null;
  authorIdentityKey: string | null;
  signalTypeKey: SignalTypeKey;
  evidenceClass: EvidenceClass;
  geography: string | null;
  segment: string | null;
  painPoint: string | null;
  monetaryEvidence: MonetaryEvidence;
  publishedAt: Date | null;
  observedAt: Date;
  contentHash: string;
  simhash: string;
  originKey: string | null;
  citesUrl: string | null;
  embedding: Buffer | null;
  embeddingModel: string | null;
  evidenceUnitId: string | null;
  status: 'new' | 'processed' | 'duplicate' | 'discarded';
  halfLifeDaysOverride: number | null;
  supersededAt: Date | null;
  demo: boolean;
  createdAt: Date;
}

export interface MonetaryEvidence {
  /** Recurring amount someone is observed to pay, in workspace currency. */
  monthlyAmount?: number;
  oneOffAmount?: number;
  currency?: string;
  quote?: string;
}

export interface NewSignal {
  sourceId?: string | null;
  externalId?: string | null;
  title: string;
  url?: string | null;
  bodyText: string;
  authorHandle?: string | null;
  signalTypeKey: SignalTypeKey;
  evidenceClass: EvidenceClass;
  geography?: string | null;
  segment?: string | null;
  painPoint?: string | null;
  monetaryEvidence?: MonetaryEvidence;
  publishedAt?: Date | null;
  observedAt: Date;
  citesUrl?: string | null;
  entityNames?: string[];
  halfLifeDaysOverride?: number | null;
  demo?: boolean;
}

export interface SignalFilter {
  signalTypes?: SignalTypeKey[];
  evidenceClasses?: EvidenceClass[];
  status?: Array<'new' | 'processed' | 'duplicate' | 'discarded'>;
  search?: string;
  geography?: string;
  segment?: string;
  observedAfter?: Date;
  observedBefore?: Date;
  clusterId?: string;
  opportunityId?: string;
  includeDemo?: boolean;
  limit?: number;
  offset?: number;
}

export interface SignalRepository {
  insert(workspaceId: string, input: NewSignal & { computed: ComputedSignalFields }): Promise<SignalRow>;
  findById(workspaceId: string, id: string): Promise<SignalRow | null>;
  /**
   * Finds an item already read from this source. A re-fetch of the identical
   * item is the same observation seen twice, not a new one.
   */
  findByExternalId(workspaceId: string, sourceId: string, externalId: string): Promise<SignalRow | null>;
  /** Records that an existing item was seen again, without creating a mention. */
  touchObserved(signalId: string, observedAt: Date): Promise<void>;
  list(workspaceId: string, filter?: SignalFilter): Promise<{ rows: SignalRow[]; total: number }>;
  /**
   * Candidates the dedupe cascade should compare against. Narrowed by blocking
   * keys so the comparison stays small, rather than scanning every signal.
   */
  findDedupeCandidates(
    workspaceId: string,
    input: { contentHash: string; canonicalUrl: string | null; sourceId: string | null; externalId: string | null; observedAt: Date; windowDays: number; limit?: number },
  ): Promise<SignalRow[]>;
  attachToEvidenceUnit(signalId: string, evidenceUnitId: string, status: SignalRow['status']): Promise<void>;
  recordProcessing(signalId: string, event: { stage: string; decision: string; reasonCode?: string; detail?: Record<string, unknown> }): Promise<void>;
  listProcessing(signalId: string): Promise<Array<{ stage: string; decision: string; reasonCode: string | null; detail: Record<string, unknown>; createdAt: Date }>>;
  linkEntities(signalId: string, entityIds: string[]): Promise<void>;
  entityKeysFor(signalIds: string[]): Promise<Map<string, string[]>>;
  countByType(workspaceId: string): Promise<Array<{ signalTypeKey: SignalTypeKey; count: number }>>;
}

export interface ComputedSignalFields {
  canonicalUrl: string | null;
  contentHash: string;
  simhash: string;
  originKey: string | null;
  authorIdentityKey: string | null;
  embedding: Buffer | null;
  embeddingModel: string | null;
}

export interface EvidenceUnitRow {
  id: string;
  workspaceId: string;
  canonicalClaim: string;
  evidenceClass: EvidenceClass;
  signalTypeKey: SignalTypeKey;
  representativeSignalId: string | null;
  mentionCount: number;
  independentSourceCount: number;
  baseStrength: number;
  effectiveStrength: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  demo: boolean;
}

export interface EvidenceRepository {
  create(
    workspaceId: string,
    input: {
      canonicalClaim: string;
      evidenceClass: EvidenceClass;
      signalTypeKey: SignalTypeKey;
      representativeSignalId: string;
      baseStrength: number;
      effectiveStrength: number;
      observedAt: Date;
      demo: boolean;
    },
  ): Promise<EvidenceUnitRow>;
  addMention(
    evidenceUnitId: string,
    signalId: string,
    input: { role: 'primary' | 'corroborating' | 'duplicate'; dedupeReason: DedupeReason; detail: Record<string, unknown>; observedAt: Date },
  ): Promise<void>;
  findById(workspaceId: string, id: string): Promise<EvidenceUnitRow | null>;
  listByIds(workspaceId: string, ids: string[]): Promise<EvidenceUnitRow[]>;
  /** Mentions behind a set of units, for computing the three headline counts. */
  mentionsFor(evidenceUnitIds: string[]): Promise<Array<{ evidenceUnitId: string; originKey: string | null; authorIdentityKey: string | null; evidenceClass: EvidenceClass }>>;
  refreshCounts(evidenceUnitId: string, counts: { mentionCount: number; independentSourceCount: number }): Promise<void>;
  updateStrength(evidenceUnitId: string, effectiveStrength: number, computedAt: Date): Promise<void>;
  affiliations(workspaceId: string): Promise<Map<string, string>>;
  /**
   * Everything the clustering engine needs about a set of evidence, in one
   * query: the claim, its vector, its entities and the origins behind it.
   */
  listClusterable(
    workspaceId: string,
    options?: { evidenceUnitIds?: string[]; unclusteredOnly?: boolean; limit?: number },
  ): Promise<ClusterableEvidenceRow[]>;
}

export interface ClusterableEvidenceRow {
  id: string;
  claimText: string;
  /** Body of the representative signal, so clustering sees the substance. */
  bodyText: string;
  embedding: Buffer | null;
  embeddingModel: string | null;
  entityKeys: string[];
  evidenceClass: EvidenceClass;
  signalTypeKey: SignalTypeKey;
  /** Set when the underlying claim has been superseded; stops time decay. */
  supersededAt: Date | null;
  halfLifeDaysOverride: number | null;
  originKeys: string[];
  mentionCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  strength: number;
}

export interface EntityRepository {
  upsertMany(workspaceId: string, names: Array<{ name: string; kind?: string }>): Promise<Array<{ id: string; matchKey: string }>>;
}
