import { createAnthropicProvider } from '../adapters/ai/anthropic';
import { createFixtureProvider } from '../adapters/ai/fixture-provider';
import { createGeminiProvider } from '../adapters/ai/gemini';
import { createNullProvider } from '../adapters/ai/null-provider';
import { createOpenAiProvider } from '../adapters/ai/openai';
import type { AIProvider } from '../ports/ai';
import { ProviderUnavailable } from '../ports/ai';
import type { GatewayDeps } from '../pipeline/ai-gateway';
import type { Container } from './container';

/**
 * Builds a callable provider from a configured row.
 *
 * Credentials are decrypted here and nowhere else, and only for the duration of
 * the call. The env-var path exists for headless deployments where there is no
 * interface to paste a key into.
 */
export function aiGateway(c: Container): GatewayDeps {
  const cache = new Map<string, AIProvider>();

  return {
    repos: c.repos,
    clock: c.clock,

    async providerFor(workspaceId: string, providerId: string): Promise<AIProvider> {
      const key = `${workspaceId}:${providerId}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const provider = await buildProvider(c, workspaceId, providerId);
      cache.set(key, provider);
      return provider;
    },
  };
}

async function buildProvider(
  c: Container,
  workspaceId: string,
  providerId: string,
): Promise<AIProvider> {
  // The fixture provider is selected by environment rather than by row, so a
  // test run cannot accidentally reach a real provider even if one is
  // configured in the database it is pointed at.
  if (c.env.RADAR_AI_PROVIDER === 'fixture') {
    return createFixtureProvider({
      directory: c.env.RADAR_FIXTURE_DIR ?? 'fixtures/ai',
      recordMissing: c.env.RADAR_RECORD_FIXTURES === true,
    });
  }

  const rows = await c.repos.ai.listProviders(workspaceId);
  const row = rows.find((entry) => entry.id === providerId);
  if (!row || !row.enabled) return createNullProvider();

  const apiKey = await resolveKey(c, row.secretId, row.kind);
  if (!apiKey) {
    throw new ProviderUnavailable(
      `No credential is stored for ${row.label}.`,
      'Add the API key in Settings → AI.',
    );
  }

  switch (row.kind) {
    case 'openai':
    case 'openai_compatible':
      return createOpenAiProvider({ apiKey, baseUrl: row.baseUrl, label: row.label });
    case 'anthropic':
      return createAnthropicProvider({ apiKey, baseUrl: row.baseUrl, label: row.label });
    case 'gemini':
      return createGeminiProvider({ apiKey, baseUrl: row.baseUrl, label: row.label });
    case 'fixture':
      return createFixtureProvider({ directory: c.env.RADAR_FIXTURE_DIR ?? 'fixtures/ai' });
    default:
      return createNullProvider();
  }
}

async function resolveKey(
  c: Container,
  secretId: string | null,
  kind: string,
): Promise<string | null> {
  if (secretId) {
    const sealed = await c.repos.secrets.find(secretId);
    if (sealed) return c.secretBox.open(sealed);
  }

  // Environment fallback for headless deployments, where there is no browser to
  // paste a key into.
  const fromEnv: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    openai_compatible: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };

  return fromEnv[kind] ?? null;
}
