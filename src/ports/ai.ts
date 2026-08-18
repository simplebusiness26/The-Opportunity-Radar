import type { AiRole } from '../domain/budget/index';

export interface CompletionRequest {
  modelKey: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  temperature: number;
  /** JSON Schema the provider should enforce natively where it can. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

export interface CompletionResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Provider's own model identifier, which may differ from what was asked. */
  modelKey: string;
  finishReason: 'stop' | 'length' | 'refusal' | 'other';
}

export interface EmbeddingRequest {
  modelKey: string;
  input: string[];
}

export interface EmbeddingResponse {
  vectors: Float32Array[];
  inputTokens: number;
  modelKey: string;
}

/**
 * A provider reports whether it is reachable; the caller stamps when, because
 * the caller is the one holding the clock.
 */
export interface ProviderHealth {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/**
 * A model provider.
 *
 * Deliberately narrow, and implemented with plain fetch rather than a vendor
 * SDK, so adding a provider is a file rather than a dependency and no provider
 * can quietly become load-bearing for the architecture.
 */
export interface AIProvider {
  readonly key: string;
  readonly kind: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  healthCheck(): Promise<ProviderHealth>;
  supports(role: AiRole): boolean;
}

/** Raised when a provider fails in a way that retrying might fix. */
export class ProviderTransientError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderTransientError';
    this.status = status;
  }
}

/** Raised when retrying cannot help: bad credentials, unknown model, refusal. */
export class ProviderPermanentError extends Error {
  readonly status?: number;
  readonly remedy?: string;
  constructor(message: string, options: { status?: number; remedy?: string } = {}) {
    super(message);
    this.name = 'ProviderPermanentError';
    this.status = options.status;
    this.remedy = options.remedy;
  }
}

/** Raised when no provider is configured at all. Holds work rather than failing it. */
export class ProviderUnavailable extends Error {
  readonly remedy: string;
  constructor(message: string, remedy: string) {
    super(message);
    this.name = 'ProviderUnavailable';
    this.remedy = remedy;
  }
}
