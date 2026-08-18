import { createHash } from 'node:crypto';
import { revealUntrusted } from '../../domain/types/untrusted';
import { sanitiseErrorMessage } from '../../domain/text/sanitise';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { HttpFetcher } from '../../ports/http';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { SecretBox } from '../../ports/secret-box';
import type { SourceRow, SourceStatus } from '../../ports/repositories/sources';
import type { SourceAdapter } from '../../ports/source-adapter';
import { recordSignal } from '../signals/record-signal';

export interface IngestDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  http: HttpFetcher;
  adapters: Map<string, SourceAdapter>;
  secretBox: SecretBox;
  userAgent: string;
  /** Reduced by the budget governor when money is short. */
  scanDepthFactor?: number;
}

export interface IngestResult {
  sourceId: string;
  sourceName: string;
  status: SourceStatus;
  itemsSeen: number;
  /** Items that became new evidence rather than repeats of what we had. */
  newEvidence: number;
  duplicates: number;
  message: string;
  remedy: string | null;
}

/**
 * Runs one source and records what it produced.
 *
 * The counts reported are the honest three: how much was seen, how much was
 * genuinely new, and how much was a repeat. A run that fetches two hundred
 * items and learns nothing new says exactly that, rather than reporting two
 * hundred signals.
 */
export async function ingestSource(
  deps: IngestDeps,
  ctx: ActorCtx,
  sourceId: string,
  options: { runId?: string } = {},
): Promise<IngestResult> {
  if (!can(ctx, 'signals.write')) throw errors.forbidden('signals.write');

  const source = await deps.repos.sources.findById(ctx.workspaceId, sourceId);
  if (!source) throw errors.notFound('Source');

  const adapter = deps.adapters.get(source.adapterKey);
  if (!adapter) {
    await recordOutcome(deps, source, {
      status: 'failing',
      message: `No adapter named "${source.adapterKey}" is installed.`,
      remedy: 'Remove this source, or upgrade Radar to a version that includes the adapter.',
      itemsFetched: 0,
      succeeded: false,
    });
    throw errors.preconditionFailed('source.no_adapter', `Unknown adapter: ${source.adapterKey}`);
  }

  const config = await resolveConfig(deps, source);
  const validation = adapter.validateConfig(config);

  if (!validation.ok) {
    // Not configured is a distinct state from failing. The source is waiting
    // for the owner, and the interface should say so rather than showing an
    // error that implies something is broken.
    await recordOutcome(deps, source, {
      status: 'not_configured',
      message: validation.message,
      remedy: validation.remedy,
      itemsFetched: 0,
      succeeded: false,
    });

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: 'not_configured',
      itemsSeen: 0,
      newEvidence: 0,
      duplicates: 0,
      message: validation.message,
      remedy: validation.remedy,
    };
  }

  const state = await deps.repos.sources.state(source.id);
  const startedAtMs = deps.clock.epochMs();

  const maxItems = Math.max(
    5,
    Math.round(source.maxItemsPerRun * (deps.scanDepthFactor ?? 1)),
  );

  try {
    const page = await adapter.fetch(
      { http: deps.http, config, maxItems, userAgent: deps.userAgent },
      state?.cursor ?? null,
    );

    let newEvidence = 0;
    let duplicates = 0;

    for (const item of page.items) {
      const normalized = adapter.normalize(item);
      const body = revealUntrusted(normalized.bodyText);

      // Too short to be evidence of anything. Dropping it here keeps the
      // dedupe and AI stages from paying to consider noise.
      if (body.trim().length < 40) continue;

      await deps.repos.sources.recordFetch(
        ctx.workspaceId,
        {
          sourceId: source.id,
          runId: options.runId ?? null,
          url: normalized.url ?? `${source.adapterKey}:${normalized.externalId}`,
          httpStatus: 200,
          contentHash: createHash('sha256').update(body).digest('hex'),
          bytes: body.length,
          robotsDecision: adapter.manifest.respectsRobots ? 'allowed' : 'not_applicable',
        },
        deps.clock.now(),
      );

      const result = await recordSignal(deps, ctx, {
        sourceId: source.id,
        externalId: normalized.externalId,
        title: normalized.title,
        bodyText: body,
        url: normalized.url,
        signalTypeKey: normalized.signalTypeKey,
        evidenceClass: normalized.evidenceClass,
        authorHandle: normalized.authorHandle,
        publishedAt: normalized.publishedAt,
        observedAt: deps.clock.now(),
        citesUrl: normalized.citesUrl,
        entityNames: normalized.entityNames,
        monetaryEvidence: normalized.monetaryEvidence,
      });

      if (result.outcome === 'new_evidence') newEvidence += 1;
      else duplicates += 1;
    }

    const durationMs = deps.clock.epochMs() - startedAtMs;

    await recordOutcome(deps, source, {
      status: 'ok',
      cursor: page.cursor,
      message:
        page.items.length === 0
          ? 'Ran successfully; the source had nothing new.'
          : `${page.items.length} items seen, ${newEvidence} new, ${duplicates} already known.`,
      itemsFetched: page.items.length,
      durationMs,
      succeeded: true,
    });

    await deps.repos.runStats.record(ctx.workspaceId, {
      runId: options.runId ?? null,
      kind: 'ingest',
      itemsSeen: page.items.length,
      itemsRetained: newEvidence,
      duplicatesDropped: duplicates,
      durationMs,
    });

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: 'ok',
      itemsSeen: page.items.length,
      newEvidence,
      duplicates,
      message:
        newEvidence === 0 && page.items.length > 0
          ? `${page.items.length} items seen, none of them new. Repetition is not corroboration, so nothing was added.`
          : `${newEvidence} new piece(s) of evidence from ${page.items.length} item(s).`,
      remedy: null,
    };
  } catch (error) {
    const failures = (state?.consecutiveFailures ?? 0) + 1;
    // Sanitised before storage: a driver error embeds the failing statement's
    // parameters, which for Radar can include packed embeddings. Writing those
    // into a text column fails on encoding, and the encoding error then
    // replaces the real one -- turning a clear fault into a misleading one.
    const message = sanitiseErrorMessage(error);

    // Backed off exponentially so a broken source does not consume every run,
    // and so a rate-limited one is given time to recover.
    const backoffMinutes = Math.min(240, 5 * 2 ** Math.min(failures - 1, 6));

    await recordOutcome(deps, source, {
      status: failures >= 3 ? 'failing' : 'degraded',
      message,
      itemsFetched: 0,
      succeeded: false,
      backoffUntil: new Date(deps.clock.epochMs() + backoffMinutes * 60_000),
    });

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: failures >= 3 ? 'failing' : 'degraded',
      itemsSeen: 0,
      newEvidence: 0,
      duplicates: 0,
      message,
      remedy: `Retrying in ${backoffMinutes} minutes. Check the source settings if this continues.`,
    };
  }
}

async function recordOutcome(
  deps: IngestDeps,
  source: SourceRow,
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
): Promise<void> {
  await deps.repos.sources.recordRun(source.id, input, deps.clock.now());
}

/** Merges stored settings with the decrypted credential, if there is one. */
async function resolveConfig(deps: IngestDeps, source: SourceRow): Promise<Record<string, string>> {
  const config = { ...source.config };
  if (!source.secretId) return config;

  const sealed = await deps.repos.secrets.find(source.secretId);
  if (!sealed) return config;

  // The adapter declares which field is secret, so the value goes back into the
  // key it belongs to rather than a fixed name.
  const adapter = deps.adapters.get(source.adapterKey);
  const secretField = adapter?.manifest.configFields.find((field) => field.secret);
  if (!secretField) return config;

  try {
    config[secretField.key] = deps.secretBox.open(sealed);
  } catch {
    // A credential that will not decrypt is reported through validateConfig
    // rather than throwing here, so the source shows as unconfigured.
  }
  return config;
}
