import type { AIProvider, CompletionRequest, EmbeddingRequest } from '../../ports/ai';
import { ProviderPermanentError } from '../../ports/ai';
import { providerFetch, readNumber } from './http';

/**
 * Anthropic.
 *
 * Structured output is requested through a single tool whose input schema is
 * the output schema, which is how this API enforces a shape natively.
 */
export function createAnthropicProvider(options: {
  apiKey: string;
  baseUrl?: string | null;
  label?: string;
}): AIProvider {
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const headers = {
    'x-api-key': options.apiKey,
    'anthropic-version': '2023-06-01',
  };

  return {
    key: options.label ?? 'anthropic',
    kind: 'anthropic',

    async complete(request: CompletionRequest) {
      const body: Record<string, unknown> = {
        model: request.modelKey,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
      };

      if (request.jsonSchema) {
        body.tools = [
          {
            name: request.jsonSchema.name,
            description: 'Return the analysis in this exact shape.',
            input_schema: request.jsonSchema.schema,
          },
        ];
        body.tool_choice = { type: 'tool', name: request.jsonSchema.name };
      }

      const payload = (await providerFetch(`${baseUrl}/messages`, { headers, body })) as {
        content?: Array<{ type?: string; text?: string; input?: unknown }>;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
        model?: string;
        stop_reason?: string;
      };

      // With a tool forced, the structured result arrives as the tool input
      // rather than as text.
      const toolUse = payload.content?.find((block) => block.type === 'tool_use');
      const text = toolUse?.input
        ? JSON.stringify(toolUse.input)
        : (payload.content?.find((block) => block.type === 'text')?.text ?? '');

      if (payload.stop_reason === 'refusal') {
        throw new ProviderPermanentError('The model declined to answer.');
      }

      return {
        text,
        inputTokens: readNumber(payload.usage?.input_tokens),
        outputTokens: readNumber(payload.usage?.output_tokens),
        cachedInputTokens: readNumber(payload.usage?.cache_read_input_tokens),
        modelKey: payload.model ?? request.modelKey,
        finishReason:
          payload.stop_reason === 'max_tokens'
            ? 'length'
            : payload.stop_reason === 'end_turn' || payload.stop_reason === 'tool_use'
              ? 'stop'
              : 'other',
      };
    },

    async embed(_request: EmbeddingRequest) {
      // Anthropic has no first-party embeddings endpoint. Saying so plainly is
      // better than silently returning something else, and the router simply
      // routes the embedding role elsewhere.
      throw new ProviderPermanentError('Anthropic does not provide embeddings.', {
        remedy: 'Route the embedding role to another provider in Settings → AI.',
      });
    },

    async healthCheck() {
      const startedAt = performance.now();
      try {
        await providerFetch(`${baseUrl}/messages`, {
          headers,
          body: {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ok' }],
          },
          timeoutMs: 15_000,
        });
        return { ok: true, message: 'Reachable.', latencyMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },

    supports: (role) => role !== 'embedding',
  };
}
