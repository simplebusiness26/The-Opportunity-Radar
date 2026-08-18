import { deriveMode, type ModeStatus } from '../../domain/config/mode';
import type { Repositories } from '../../ports/repositories/index';

/**
 * Gathers the real counts behind the operating mode.
 *
 * The provider, source and schedule repositories are introduced with the AI and
 * ingestion layers; until they exist the counts are genuinely zero, so a fresh
 * installation correctly reports MANUAL rather than pretending otherwise.
 */
export async function readModeStatus(repos: Repositories): Promise<ModeStatus> {
  const enabledProviders = repos.aiProviders ? await repos.aiProviders.countEnabled() : 0;
  const enabledSources = repos.sources ? await repos.sources.countEnabled() : 0;
  const enabledSchedules = repos.schedules ? await repos.schedules.countEnabled() : 0;

  return deriveMode({ enabledProviders, enabledSources, enabledSchedules });
}
