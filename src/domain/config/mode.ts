/**
 * The operating mode is derived from what is actually connected, never declared
 * in configuration. An installation cannot claim to be autonomous because
 * someone set a flag; it is autonomous when a provider, a source and a schedule
 * all genuinely exist and are enabled.
 */

export type OperatingMode = 'manual' | 'ai_assisted' | 'autonomous';

export interface ModeInputs {
  enabledProviders: number;
  enabledSources: number;
  enabledSchedules: number;
}

export interface ModeStatus {
  mode: OperatingMode;
  inputs: ModeInputs;
  /** Exactly what is missing before the next mode becomes available. */
  missingForNext: string[];
  nextMode: OperatingMode | null;
}

export function deriveMode(inputs: ModeInputs): ModeStatus {
  if (inputs.enabledProviders === 0) {
    return {
      mode: 'manual',
      inputs,
      nextMode: 'ai_assisted',
      missingForNext: ['Connect an AI provider in Settings → AI.'],
    };
  }

  if (inputs.enabledSources === 0 || inputs.enabledSchedules === 0) {
    const missing: string[] = [];
    if (inputs.enabledSources === 0) missing.push('Enable at least one intelligence source.');
    if (inputs.enabledSchedules === 0) missing.push('Enable at least one schedule.');
    return { mode: 'ai_assisted', inputs, nextMode: 'autonomous', missingForNext: missing };
  }

  return { mode: 'autonomous', inputs, nextMode: null, missingForNext: [] };
}

export const MODE_LABELS: Record<OperatingMode, string> = {
  manual: 'Manual',
  ai_assisted: 'AI assisted',
  autonomous: 'Autonomous',
};

export const MODE_DESCRIPTIONS: Record<OperatingMode, string> = {
  manual:
    'Radar runs entirely on evidence you enter yourself. Scoring, dedupe, clustering, decay and allocation are all deterministic and need no external service.',
  ai_assisted:
    'An AI provider is connected, so Radar can extract, classify, investigate and red-team. It still waits for you to start work.',
  autonomous:
    'Sources and schedules are connected. Radar scans, investigates and updates its recommendations on its own, and asks for you only where a human decision is genuinely wanted.',
};
