import type { AIProvider } from '../../ports/ai';
import { ProviderUnavailable } from '../../ports/ai';

/**
 * The provider used when none is configured.
 *
 * It throws a typed "unavailable" rather than pretending to work, which the job
 * runner turns into held work rather than a failure. Manual mode never reaches
 * it: features that need AI declare so and render an explanation instead of
 * calling and failing.
 */
export function createNullProvider(): AIProvider {
  const unavailable = (): never => {
    throw new ProviderUnavailable(
      'No AI provider is configured.',
      'Connect one in Settings → AI. Radar works in manual mode without it.',
    );
  };

  return {
    key: 'null',
    kind: 'null',
    complete: async () => unavailable(),
    embed: async () => unavailable(),
    healthCheck: async () => ({ ok: false, message: 'No AI provider configured.' }),
    supports: () => false,
  };
}
