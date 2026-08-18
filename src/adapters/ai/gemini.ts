import type { AIProvider, CompletionRequest, EmbeddingRequest } from '../../ports/ai';
import { providerFetch, readNumber } from './http';

/** Google Gemini. */
export function createGeminiProvider(options: {
  apiKey: string;
  baseUrl?: string | null;
  label?: string;
}): AIProvider {
  const baseUrl = (
    options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
  ).replace(/\/$/, '');
  const headers = { 'x-goog-api-key': options.apiKey };

  return {
    key: options.label ?? 'gemini',
    kind: 'gemini',

    async complete(request: CompletionRequest) {
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature,
      };

      if (request.jsonSchema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = toGeminiSchema(request.jsonSchema.schema);
      }

      const payload = (await providerFetch(
        `${baseUrl}/models/${encodeURIComponent(request.modelKey)}:generateContent`,
        {
          headers,
          body: {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.user }] }],
            generationConfig,
          },
        },
      )) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
      };

      const candidate = payload.candidates?.[0];

      return {
        text: (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join(''),
        inputTokens: readNumber(payload.usageMetadata?.promptTokenCount),
        outputTokens: readNumber(payload.usageMetadata?.candidatesTokenCount),
        cachedInputTokens: readNumber(payload.usageMetadata?.cachedContentTokenCount),
        modelKey: request.modelKey,
        finishReason:
          candidate?.finishReason === 'STOP'
            ? 'stop'
            : candidate?.finishReason === 'MAX_TOKENS'
              ? 'length'
              : candidate?.finishReason === 'SAFETY'
                ? 'refusal'
                : 'other',
      };
    },

    async embed(request: EmbeddingRequest) {
      const payload = (await providerFetch(
        `${baseUrl}/models/${encodeURIComponent(request.modelKey)}:batchEmbedContents`,
        {
          headers,
          body: {
            requests: request.input.map((text) => ({
              model: `models/${request.modelKey}`,
              content: { parts: [{ text }] },
            })),
          },
        },
      )) as { embeddings?: Array<{ values?: number[] }> };

      return {
        vectors: (payload.embeddings ?? []).map((entry) => Float32Array.from(entry.values ?? [])),
        // Gemini does not report embedding token usage, so it is left at zero
        // rather than invented; the ledger marks the cost as unknown.
        inputTokens: 0,
        modelKey: request.modelKey,
      };
    },

    async healthCheck() {
      const startedAt = performance.now();
      try {
        await providerFetch(`${baseUrl}/models/gemini-2.0-flash:generateContent`, {
          headers,
          body: {
            contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
            generationConfig: { maxOutputTokens: 1 },
          },
          timeoutMs: 15_000,
        });
        return { ok: true, message: 'Reachable.', latencyMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },

    supports: () => true,
  };
}

/**
 * Gemini accepts a subset of JSON Schema and rejects unknown keywords, so the
 * schema is trimmed rather than passed through verbatim.
 */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    'type',
    'format',
    'description',
    'nullable',
    'enum',
    'items',
    'properties',
    'required',
    'minimum',
    'maximum',
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      output[key] = key === 'properties' && value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child)]))
        : walk(value);
    }
    return output;
  };

  return walk(schema) as Record<string, unknown>;
}
