import type { AIProvider, CompletionRequest, EmbeddingRequest } from '../../ports/ai';
import { ProviderPermanentError } from '../../ports/ai';
import { providerFetch, readNumber } from './http';

/**
 * OpenAI, and anything that speaks its API.
 *
 * The same implementation serves self-hosted and gateway deployments through a
 * configurable base URL, which is why `openai_compatible` needs no separate
 * provider.
 */
export function createOpenAiProvider(options: {
  apiKey: string;
  baseUrl?: string | null;
  label?: string;
}): AIProvider {
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const headers = { authorization: `Bearer ${options.apiKey}` };

  return {
    key: options.label ?? 'openai',
    kind: 'openai',

    async complete(request: CompletionRequest) {
      const body: Record<string, unknown> = {
        model: request.modelKey,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        max_completion_tokens: request.maxOutputTokens,
        temperature: request.temperature,
      };

      // Native schema enforcement where it exists: far more reliable than
      // asking for JSON and hoping.
      if (request.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.jsonSchema.name,
            schema: request.jsonSchema.schema,
            strict: true,
          },
        };
      }

      const payload = (await providerFetch(`${baseUrl}/chat/completions`, { headers, body })) as {
        choices?: Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
        model?: string;
      };

      const choice = payload.choices?.[0];
      if (choice?.message?.refusal) {
        throw new ProviderPermanentError(`The model declined: ${choice.message.refusal}`);
      }

      return {
        text: choice?.message?.content ?? '',
        inputTokens: readNumber(payload.usage?.prompt_tokens),
        outputTokens: readNumber(payload.usage?.completion_tokens),
        cachedInputTokens: readNumber(payload.usage?.prompt_tokens_details?.cached_tokens),
        modelKey: payload.model ?? request.modelKey,
        finishReason: mapFinish(choice?.finish_reason),
      };
    },

    async embed(request: EmbeddingRequest) {
      const payload = (await providerFetch(`${baseUrl}/embeddings`, {
        headers,
        body: { model: request.modelKey, input: request.input },
      })) as {
        data?: Array<{ embedding?: number[] }>;
        usage?: { prompt_tokens?: number };
        model?: string;
      };

      return {
        vectors: (payload.data ?? []).map((entry) => Float32Array.from(entry.embedding ?? [])),
        inputTokens: readNumber(payload.usage?.prompt_tokens),
        modelKey: payload.model ?? request.modelKey,
      };
    },

    async healthCheck() {
      const startedAt = performance.now();
      try {
        await providerFetch(`${baseUrl}/chat/completions`, {
          headers,
          body: {
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'ok' }],
            max_completion_tokens: 1,
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

function mapFinish(reason: string | undefined): 'stop' | 'length' | 'refusal' | 'other' {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'refusal';
  return 'other';
}
