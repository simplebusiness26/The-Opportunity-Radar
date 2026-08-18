import { deriveMode, type ModeStatus } from '../../domain/config/mode';
import type { Repositories } from '../../ports/repositories/index';

/**
 * Gathers the real counts behind the operating mode.
 *
 * The mode is derived from what is actually connected, never declared. The
 * provider and source repositories arrive with the AI and ingestion layers;
 * until then their counts are genuinely zero, so a fresh installation reports
 * MANUAL because it is manual, not because a flag says so.
 */
export async function readModeStatus(
  repos: Repositories,
  workspaceId: string,
): Promise<ModeStatus> {
  const enabledProviders = await repos.ai.countEnabled(workspaceId);
  const enabledSources = await repos.sources.countEnabled(workspaceId);
  const enabledSchedules = await repos.schedules.countEnabled(workspaceId);

  return deriveMode({ enabledProviders, enabledSources, enabledSchedules });
}
