import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AIProvider, CompletionRequest, EmbeddingRequest } from '../../ports/ai';
import { ProviderPermanentError } from '../../ports/ai';
import { lexicalEmbedding } from '../../domain/dedupe/embedding';

/**
 * A provider that replays recorded responses.
 *
 * This is what lets the entire AI pipeline -- extraction, red teaming, fit
 * reasoning -- be exercised end to end with no credentials and no network, and
 * produce the same result every run.
 *
 * A missing recording is a hard, loud failure naming the exact key, never a
 * silently invented answer. A fixture suite that quietly fabricates responses
 * would test nothing while appearing to test everything.
 */
export interface FixtureProviderOptions {
  directory: string;
  /** When set, unmatched calls are written out as templates to fill in. */
  recordMissing?: boolean;
}

interface FixtureFile {
  key: string;
  note?: string;
  response: {
    text: string;
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: 'stop' | 'length' | 'refusal' | 'other';
  };
}

export function fixtureKey(input: {
  modelKey: string;
  system: string;
  user: string;
  promptVersion?: string;
  schemaVersion?: string;
}): string {
  // The prompt and schema versions are part of the key on purpose: changing a
  // prompt must invalidate its recordings rather than passing on a stale one.
  return createHash('sha256')
    .update(
      [
        input.promptVersion ?? 'v0',
        input.schemaVersion ?? 'v0',
        input.modelKey,
        input.system,
        input.user,
      ].join('\n--\n'),
    )
    .digest('hex')
    .slice(0, 32);
}

export function createFixtureProvider(options: FixtureProviderOptions): AIProvider {
  const index = loadIndex(options.directory);

  return {
    key: 'fixture',
    kind: 'fixture',

    async complete(request: CompletionRequest) {
      const key = fixtureKey({
        modelKey: request.modelKey,
        system: request.system,
        user: request.user,
        promptVersion: request.jsonSchema?.name,
      });

      const fixture = index.get(key);

      if (!fixture) {
        if (options.recordMissing) {
          writeTemplate(options.directory, key, request);
        }
        throw new ProviderPermanentError(
          `No recorded response for fixture key ${key}. ` +
            `Record one at ${join(options.directory, `${key}.json`)}, or run with RADAR_RECORD_FIXTURES=1 to write a template.`,
          { remedy: 'Add the missing fixture rather than loosening the test.' },
        );
      }

      return {
        text: fixture.response.text,
        inputTokens: fixture.response.inputTokens ?? Math.ceil(request.user.length / 3.4),
        outputTokens: fixture.response.outputTokens ?? Math.ceil(fixture.response.text.length / 3.4),
        cachedInputTokens: 0,
        modelKey: request.modelKey,
        finishReason: fixture.response.finishReason ?? 'stop',
      };
    },

    async embed(request: EmbeddingRequest) {
      // Deterministic and dependency-free, so embedding-dependent behaviour is
      // testable without a provider. Labelled as lexical wherever it surfaces.
      return {
        vectors: request.input.map((text) => lexicalEmbedding(text)),
        inputTokens: request.input.reduce((total, text) => total + Math.ceil(text.length / 3.4), 0),
        modelKey: 'lexical-v1',
      };
    },

    async healthCheck() {
      return { ok: true, message: `${index.size} recorded responses available.` };
    },

    supports: () => true,
  };
}

function loadIndex(directory: string): Map<string, FixtureFile> {
  const index = new Map<string, FixtureFile>();
  if (!existsSync(directory)) return index;

  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const fixture = JSON.parse(readFileSync(join(directory, entry), 'utf8')) as FixtureFile;
      if (fixture.key) index.set(fixture.key, fixture);
    } catch {
      // A malformed fixture is skipped; the resulting miss reports the exact
      // key, which is more useful than failing to start.
    }
  }

  return index;
}

function writeTemplate(directory: string, key: string, request: CompletionRequest): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${key}.json`),
    `${JSON.stringify(
      {
        key,
        note: 'Template written by the fixture provider. Fill in response.text.',
        request: { modelKey: request.modelKey, system: request.system, user: request.user },
        response: { text: '' },
      },
      null,
      2,
    )}\n`,
  );
}
