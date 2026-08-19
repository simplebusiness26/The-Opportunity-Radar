import type { SourceRepository } from '../../ports/repositories/sources';

const MANAGED_BY = 'operating-system-auto-watch';
const MAX_WATCHES = 4;
const POLL_INTERVAL_SEC = 3600;
const MAX_ITEMS_PER_RUN = 25;

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','being','build','building','built','by','create','creating','for','from','get','getting','have','how','i','in','into','is','it','make','making','of','on','or','our','project','projects','ship','shipping','system','systems','that','the','their','this','to','using','we','with','you','your',
]);

const METADATA_ONLY = /^(primary language|topics|homepage|visibility)\b/i;

export interface OsWatchSeed {
  projects: Array<{ name: string; summary: string; goal: string }>;
  capabilities: Array<{ name: string; capability: string }>;
  goals: Array<{ name: string; priority: number; target?: string | null }>;
}

export interface ManagedWatchResult {
  managedSources: number;
  activeSources: number;
  queries: string[];
}

function normalizePhrase(raw: string): string {
  const cleaned = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}+#.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || METADATA_ONLY.test(cleaned)) return '';

  const meaningful = cleaned
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const lower = token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9+#.-]+$/g, '');
      return lower.length >= 2 && !STOP_WORDS.has(lower);
    });

  if (meaningful.length < 2) return '';
  return meaningful.slice(0, 6).join(' ').slice(0, 120);
}

function queryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
}

/**
 * Turn the owner's own operating context into a small, deterministic watchlist.
 * No model is required and no project data is treated as market evidence; this
 * only decides what the external source adapter should search for next.
 */
export function deriveOsWatchQueries(snapshot: OsWatchSeed): string[] {
  const candidates: Array<{ value: string; weight: number }> = [];

  for (const goal of [...snapshot.goals].sort((a, b) => b.priority - a.priority)) {
    candidates.push({ value: `${goal.name}${goal.target ? ` ${goal.target}` : ''}`, weight: 100 + goal.priority });
  }

  for (const project of snapshot.projects) {
    if (project.goal.trim()) candidates.push({ value: project.goal, weight: 80 });
  }

  for (const capability of snapshot.capabilities) {
    candidates.push({ value: capability.name || capability.capability, weight: 60 });
  }

  for (const project of snapshot.projects) {
    if (project.summary.trim()) candidates.push({ value: project.summary.split(/[.!?\n]/)[0] ?? '', weight: 40 });
  }

  const seen = new Set<string>();
  const queries: string[] = [];

  for (const candidate of candidates.sort((a, b) => b.weight - a.weight)) {
    const phrase = normalizePhrase(candidate.value);
    const key = queryKey(phrase);
    if (!phrase || !key || seen.has(key)) continue;

    const duplicate = [...seen].some((existing) => existing.includes(key) || key.includes(existing));
    if (duplicate) continue;

    seen.add(key);
    queries.push(phrase);
    if (queries.length >= MAX_WATCHES) break;
  }

  return queries;
}

/**
 * Maintain only the sources Radar created itself. User-created sources are never
 * renamed, reconfigured or re-enabled here.
 */
export async function maintainOsManagedHackerNewsWatches(
  sources: SourceRepository,
  workspaceId: string,
  snapshot: OsWatchSeed,
  now: Date,
): Promise<ManagedWatchResult> {
  const queries = deriveOsWatchQueries(snapshot);
  const existing = await sources.list(workspaceId);
  const managed = existing
    .filter((source) => source.adapterKey === 'hacker_news' && source.config.managedBy === MANAGED_BY)
    .sort((a, b) => Number(a.config.autoWatchSlot ?? 999) - Number(b.config.autoWatchSlot ?? 999));

  for (let index = 0; index < queries.length; index += 1) {
    const slot = String(index + 1);
    const query = queries[index]!;
    const source = managed.find((item) => item.config.autoWatchSlot === slot) ?? managed[index];
    const config = {
      ...(source?.config ?? {}),
      managedBy: MANAGED_BY,
      autoWatchSlot: slot,
      autoInactive: 'false',
      query,
      minPoints: '3',
    };

    if (!source) {
      await sources.create(workspaceId, {
        adapterKey: 'hacker_news',
        name: `OS market watch ${slot}`,
        category: 'community',
        config,
        enabled: true,
        pollIntervalSec: POLL_INTERVAL_SEC,
        maxItemsPerRun: MAX_ITEMS_PER_RUN,
      });
      continue;
    }

    const autoInactive = source.config.autoInactive === 'true';
    await sources.update(workspaceId, source.id, {
      config,
      enabled: autoInactive ? true : source.enabled,
      pollIntervalSec: POLL_INTERVAL_SEC,
      maxItemsPerRun: MAX_ITEMS_PER_RUN,
    }, now);
  }

  for (const source of managed) {
    const slot = Number(source.config.autoWatchSlot ?? 0);
    if (slot > 0 && slot <= queries.length) continue;
    if (!source.enabled && source.config.autoInactive === 'true') continue;
    await sources.update(workspaceId, source.id, {
      enabled: false,
      config: { ...source.config, autoInactive: 'true' },
    }, now);
  }

  return {
    managedSources: Math.max(managed.length, queries.length),
    activeSources: queries.length,
    queries,
  };
}
