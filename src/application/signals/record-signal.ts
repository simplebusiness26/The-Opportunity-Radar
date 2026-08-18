import { z } from 'zod';
import { canonicaliseUrl, originKey } from '../../domain/dedupe/canonical-url';
import { classifyDuplicate, computeEvidenceCounts, DEFAULT_THRESHOLDS } from '../../domain/dedupe/cascade';
import type { DedupeCandidate } from '../../domain/dedupe/cascade';
import { contentHash, simhash } from '../../domain/dedupe/fingerprint';
import { LEXICAL_MODEL, lexicalEmbedding, packEmbedding, unpackEmbedding } from '../../domain/dedupe/embedding';
import { computeDecay } from '../../domain/decay/index';
import { SIGNAL_TYPE_KEYS } from '../../domain/taxonomy/signal-types';
import { EVIDENCE_CLASS_KEYS } from '../../domain/taxonomy/evidence-class';
import { slugify } from '../../domain/text/slug';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { SignalRow } from '../../ports/repositories/intelligence';

export const recordSignalInput = z.object({
  title: z.string().trim().min(3, 'Give the signal a title.').max(300),
  bodyText: z.string().trim().min(10, 'Include the actual evidence, not just a label.').max(50_000),
  url: z.string().url().max(2000).optional().nullable(),
  signalTypeKey: z.enum(SIGNAL_TYPE_KEYS as [string, ...string[]]),
  evidenceClass: z.enum(EVIDENCE_CLASS_KEYS as [string, ...string[]]),
  authorHandle: z.string().trim().max(200).optional().nullable(),
  geography: z.string().trim().max(120).optional().nullable(),
  segment: z.string().trim().max(200).optional().nullable(),
  painPoint: z.string().trim().max(500).optional().nullable(),
  monetaryEvidence: z
    .object({
      monthlyAmount: z.number().nonnegative().max(10_000_000).optional(),
      oneOffAmount: z.number().nonnegative().max(100_000_000).optional(),
      currency: z.string().length(3).optional(),
      quote: z.string().max(1000).optional(),
    })
    .optional(),
  publishedAt: z.coerce.date().optional().nullable(),
  observedAt: z.coerce.date().optional(),
  citesUrl: z.string().url().max(2000).optional().nullable(),
  /**
   * Who this came from, when there is no URL to derive it from: "Interview with
   * the manager at Bella's", "Support ticket #482". Two entries naming the same
   * source count as one source, which is what keeps hand-entered evidence
   * honest.
   */
  sourceLabel: z.string().trim().max(200).optional().nullable(),
  entityNames: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  sourceId: z.string().uuid().optional().nullable(),
  externalId: z.string().max(300).optional().nullable(),
  demo: z.boolean().optional(),
});

export type RecordSignalInput = z.infer<typeof recordSignalInput>;

export interface SignalDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface RecordSignalResult {
  signal: SignalRow;
  /**
   * Whether this became new evidence, joined something already known, or was
   * simply the same source item read again.
   */
  outcome: 'new_evidence' | 'corroborates_existing' | 'duplicate' | 'already_read';
  evidenceUnitId: string;
  dedupeReason: string;
  explanation: string;
}

/**
 * Records one signal and places it in the evidence graph.
 *
 * Everything expensive is avoided until it is needed: the exact-match tests run
 * first, then fingerprints, and only then vectors. This ordering is what keeps
 * ingestion cheap, and it is the same ordering the autonomous pipeline uses.
 */
export async function recordSignal(
  deps: SignalDeps,
  ctx: ActorCtx,
  input: RecordSignalInput,
): Promise<RecordSignalResult> {
  if (!can(ctx, 'signals.write')) {
    throw errors.forbidden('signals.write_denied', 'Your role cannot add evidence.');
  }

  const parsed = recordSignalInput.parse(input);
  const now = deps.clock.now();
  const observedAt = parsed.observedAt ?? now;

  if (observedAt.getTime() > now.getTime() + 60_000) {
    throw errors.validation('signal.future_observation', 'A signal cannot be observed in the future.');
  }

  const canonical = parsed.url ? canonicaliseUrl(parsed.url) : null;
  // The body is the claim; the headline is editorial. Hashing the body alone
  // means a repost with a rewritten headline is caught by the cheap exact test
  // rather than falling through to fingerprint comparison.
  const hash = contentHash(parsed.bodyText);
  const fingerprint = simhash(`${parsed.title}\n${parsed.bodyText}`);
  const vector = lexicalEmbedding(`${parsed.title}\n${parsed.bodyText}`);

  const decay = computeDecay({
    signalType: parsed.signalTypeKey as never,
    evidenceClass: parsed.evidenceClass as never,
    observedAt,
    now,
    halfLifeDaysOverride: null,
  });

  /*
   * A source re-read is not new evidence, and not even a new mention: it is the
   * same observation seen again. Sources are polled repeatedly by design, so
   * without this every poll would either violate the uniqueness constraint or,
   * worse, inflate the mention count with copies of one observation.
   */
  if (parsed.sourceId && parsed.externalId) {
    const existing = await deps.repos.signals.findByExternalId(
      ctx.workspaceId,
      parsed.sourceId,
      parsed.externalId,
    );

    if (existing) {
      await deps.repos.signals.touchObserved(existing.id, now);
      return {
        signal: existing,
        evidenceUnitId: existing.evidenceUnitId ?? '',
        outcome: 'already_read',
        dedupeReason: 'source_item_id',
        explanation:
          'Already read from this source. Polling the same item again is the same observation, so nothing was added.',
      };
    }
  }

  return deps.tx.transaction(async (repos) => {
    const entityRecords = await repos.entities.upsertMany(
      ctx.workspaceId,
      (parsed.entityNames ?? []).map((name) => ({ name })),
    );

    const signal = await repos.signals.insert(ctx.workspaceId, {
      ...parsed,
      signalTypeKey: parsed.signalTypeKey as never,
      evidenceClass: parsed.evidenceClass as never,
      observedAt,
      computed: {
        canonicalUrl: canonical,
        contentHash: hash,
        simhash: fingerprint.toString(),
        originKey: resolveOriginKey({
          canonical,
          citesUrl: parsed.citesUrl ?? null,
          sourceLabel: parsed.sourceLabel ?? null,
          contentHash: hash,
        }),
        authorIdentityKey: parsed.authorHandle
          ? `author:${parsed.authorHandle.trim().toLowerCase()}`
          : null,
        embedding: packEmbedding(vector),
        embeddingModel: LEXICAL_MODEL,
      },
    });

    await repos.signals.linkEntities(
      signal.id,
      entityRecords.map((entity) => entity.id),
    );

    const candidates = await repos.signals.findDedupeCandidates(ctx.workspaceId, {
      contentHash: hash,
      canonicalUrl: canonical,
      sourceId: parsed.sourceId ?? null,
      externalId: parsed.externalId ?? null,
      observedAt,
      windowDays: DEFAULT_THRESHOLDS.temporalWindowDays,
    });

    const comparable = candidates.filter((row) => row.id !== signal.id && row.evidenceUnitId !== null);
    const entityKeys = await repos.signals.entityKeysFor([
      signal.id,
      ...comparable.map((row) => row.id),
    ]);

    const decision = classifyDuplicate(
      toCandidate(signal, entityKeys.get(signal.id) ?? []),
      comparable.map((row) => toCandidate(row, entityKeys.get(row.id) ?? [])),
    );

    await repos.signals.recordProcessing(signal.id, {
      stage: 'dedupe',
      decision: decision.reason,
      reasonCode: decision.reason,
      detail: { ...decision.detail, matchedSignalId: decision.matchedId, confidence: decision.confidence },
    });

    const matched = decision.matchedId
      ? comparable.find((row) => row.id === decision.matchedId)
      : undefined;

    let evidenceUnitId: string;
    let outcome: RecordSignalResult['outcome'];

    if (matched?.evidenceUnitId) {
      evidenceUnitId = matched.evidenceUnitId;
      outcome = decision.role === 'corroborating' ? 'corroborates_existing' : 'duplicate';
    } else {
      const unit = await repos.evidence.create(ctx.workspaceId, {
        canonicalClaim: parsed.painPoint?.trim() || parsed.title,
        evidenceClass: parsed.evidenceClass as never,
        signalTypeKey: parsed.signalTypeKey as never,
        representativeSignalId: signal.id,
        baseStrength: decay.baseStrength,
        effectiveStrength: decay.effectiveStrength,
        observedAt,
        demo: parsed.demo ?? false,
      });
      evidenceUnitId = unit.id;
      outcome = 'new_evidence';
    }

    await repos.evidence.addMention(evidenceUnitId, signal.id, {
      role: decision.role,
      dedupeReason: decision.reason,
      detail: decision.detail,
      observedAt,
    });

    await repos.signals.attachToEvidenceUnit(
      signal.id,
      evidenceUnitId,
      outcome === 'new_evidence' ? 'processed' : 'duplicate',
    );

    // The three headline counts are recomputed from the mentions themselves
    // rather than incremented, so they can never drift out of step.
    //
    // Sequential, not concurrent: these run inside a transaction and therefore
    // share one connection. Two queries in flight on the same connection
    // interleave their protocol messages and desynchronise it.
    const mentions = await repos.evidence.mentionsFor([evidenceUnitId]);
    const affiliations = await repos.evidence.affiliations(ctx.workspaceId);
    const counts = computeEvidenceCounts(mentions, affiliations);
    await repos.evidence.refreshCounts(evidenceUnitId, {
      mentionCount: counts.rawMentions,
      independentSourceCount: counts.independentSources,
    });

    await repos.audit.record(ctx, {
      action: 'signal.recorded',
      entityType: 'signal',
      entityId: signal.id,
      after: { outcome, dedupeReason: decision.reason, evidenceUnitId },
    });

    /*
     * Appended in the same transaction as the write it describes, so the
     * outbox can never claim something happened that did not. What it causes
     * -- clustering, and checking re-evaluation triggers -- is decided by the
     * event router rather than here.
     */
    await repos.events.append(ctx.workspaceId, {
      kind: 'evidence.created',
      subjectType: 'evidence_unit',
      subjectId: evidenceUnitId,
      payload: {
        workspace: ctx.workspaceId,
        signalId: signal.id,
        evidenceUnitId,
        outcome,
      },
    });

    return {
      signal,
      outcome,
      evidenceUnitId,
      dedupeReason: decision.reason,
      explanation: explain(outcome, decision.reason, counts.independentSources),
    };
  });
}

/**
 * Every piece of evidence needs an origin, or it cannot be counted as an
 * independent source at all.
 *
 * Web content gets its origin from the URL. Hand-entered evidence has no URL,
 * so it falls back to the source the owner named, and failing that to the claim
 * itself -- so entering the same quote twice is one source, while two separate
 * customer interviews are two.
 */
function resolveOriginKey(input: {
  canonical: string | null;
  citesUrl: string | null;
  sourceLabel: string | null;
  contentHash: string;
}): string {
  const fromUrl = originKey(input.canonical, input.citesUrl);
  if (fromUrl) return fromUrl;
  const labelled = input.sourceLabel ? slugify(input.sourceLabel) : '';
  return labelled ? `manual:${labelled}` : `claim:${input.contentHash.slice(0, 16)}`;
}

function toCandidate(row: SignalRow, entityKeys: string[]): DedupeCandidate {
  return {
    id: row.id,
    canonicalUrl: row.canonicalUrl,
    externalId: row.externalId,
    sourceId: row.sourceId ?? 'manual',
    title: row.title,
    text: row.bodyText,
    contentHash: row.contentHash,
    simhash: BigInt(row.simhash),
    embedding: row.embedding ? unpackEmbedding(row.embedding) : null,
    embeddingModel: row.embeddingModel,
    entityKeys,
    publishedAt: row.publishedAt ?? row.observedAt,
    evidenceClass: row.evidenceClass,
    originKey: row.originKey,
    authorIdentityKey: row.authorIdentityKey,
    citesUrl: row.citesUrl,
  };
}

function explain(
  outcome: RecordSignalResult['outcome'],
  reason: string,
  independentSources: number,
): string {
  if (outcome === 'new_evidence') {
    return 'Recorded as a new piece of evidence.';
  }
  if (outcome === 'corroborates_existing') {
    return `This repeats evidence Radar already has (${reason.replace(/_/g, ' ')}), so it adds reach but not independence. That claim still rests on ${independentSources} independent ${independentSources === 1 ? 'source' : 'sources'}.`;
  }
  return `Matched existing evidence by ${reason.replace(/_/g, ' ')}, so it was counted as a repeat mention rather than new evidence.`;
}
