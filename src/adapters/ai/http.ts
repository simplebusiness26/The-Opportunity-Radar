import { ProviderPermanentError, ProviderTransientError } from '../../ports/ai';

/**
 * One HTTP path for every provider.
 *
 * Providers differ in their payloads, not in how their failures should be
 * treated: a 429 or a 503 is worth retrying elsewhere, a 401 never is. Sorting
 * that out once means the router can fall back on transient failures without
 * each provider having to agree on what transient means.
 */
export async function providerFetch(
  url: string,
  init: { headers: Record<string, string>; body: unknown; timeoutMs?: number },
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 120_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...init.headers },
      body: JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (error) {
    // A network failure or timeout is worth trying elsewhere.
    throw new ProviderTransientError(
      error instanceof Error && error.name === 'AbortError'
        ? 'The provider did not respond in time.'
        : `Could not reach the provider: ${String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.ok) return response.json();

  const detail = (await response.text().catch(() => '')).slice(0, 500);

  if (response.status === 401 || response.status === 403) {
    throw new ProviderPermanentError(`The provider rejected the credentials (${response.status}).`, {
      status: response.status,
      remedy: 'Check the API key in Settings → AI.',
    });
  }

  if (response.status === 404) {
    throw new ProviderPermanentError(`The provider does not recognise that model (404).`, {
      status: 404,
      remedy: 'Check the model identifier in Settings → AI.',
    });
  }

  if (response.status === 400 || response.status === 422) {
    throw new ProviderPermanentError(`The provider rejected the request: ${detail}`, {
      status: response.status,
    });
  }

  throw new ProviderTransientError(
    `The provider returned ${response.status}: ${detail}`,
    response.status,
  );
}

export function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
