import type { SourceAdapter } from '../../ports/source-adapter';
import { createGitHubAdapter } from './github';
import { createHackerNewsAdapter } from './hacker-news';
import { createJobBoardAdapter } from './job-board';
import { createRedditAdapter } from './reddit';
import { createRssAdapter } from './rss';

/**
 * Every source Radar knows how to read.
 *
 * Two of these -- Hacker News and any RSS feed -- need no credentials at all,
 * so a new installation has something real to ingest on its first day rather
 * than an empty list and a setup form.
 */
export function buildAdapterRegistry(): Map<string, SourceAdapter> {
  const adapters = [
    createHackerNewsAdapter(),
    createRssAdapter(),
    createJobBoardAdapter(),
    createGitHubAdapter(),
    createRedditAdapter(),
  ];

  const registry = new Map<string, SourceAdapter>();
  for (const adapter of adapters) {
    if (registry.has(adapter.manifest.adapterKey)) {
      throw new Error(`Duplicate adapter key: ${adapter.manifest.adapterKey}`);
    }
    registry.set(adapter.manifest.adapterKey, adapter);
  }
  return registry;
}

export const ADAPTER_REGISTRY = buildAdapterRegistry();

/** Adapters usable with no credentials, for the setup wizard to suggest first. */
export function adaptersNeedingNoCredentials(): SourceAdapter[] {
  return [...ADAPTER_REGISTRY.values()].filter((adapter) =>
    adapter.manifest.configFields.every((field) => !field.secret || !field.required),
  );
}
