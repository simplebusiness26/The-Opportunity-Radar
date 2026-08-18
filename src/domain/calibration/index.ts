/**
 * Learning from what actually happened.
 *
 * The system's estimates are worth adjusting only once there is enough of its
 * own history to adjust them against. Below that, the honest answer is that we
 * do not know yet -- and saying so is more useful than a correction computed
 * from three projects, which would be noise presented as insight.
 *
 * This is the part no competitor can copy: it is a record of one team's own
 * work, and it only becomes valuable by being kept honestly.
 */

/**
 * Fewer than this and a ratio is dominated by whichever project went unusually
 * well or unusually badly. The number is a judgement, but the refusal is not
 * negotiable: an adjustment made on four samples would quietly distort every
 * estimate afterwards.
 */
export const MINIMUM_SAMPLE = 8;

export interface ExecutionSample {
  predictedBuildDays: number | null;
  actualBuildDays: number | null;
  predictedConfidence: number | null;
  predictedScore: number | null;
  outcome: string;
}

export interface CalibrationResult {
  /** Samples that could contribute to at least one measure. */
  sampleSize: number;
  /** actual ÷ predicted build days. Above 1 means we underestimate. */
  buildEstimateRatio: number | null;
  /** Predicted confidence minus observed success rate. Positive is overconfidence. */
  confidenceBias: number | null;
  /** Whether these numbers may be used to adjust anything. */
  usable: boolean;
  /** Stated plainly when they may not be. */
  refusal: string | null;
  /** What each measure was computed from, for display. */
  notes: string[];
  buildSampleSize: number;
  confidenceSampleSize: number;
}

/** Outcomes that count as the thing having worked. */
const SUCCESSFUL = new Set(['succeeded', 'shipped_and_used', 'profitable']);

/** Outcomes that count as it not having worked. */
const UNSUCCESSFUL = new Set(['failed', 'abandoned', 'shipped_unused']);

export function computeCalibration(samples: readonly ExecutionSample[]): CalibrationResult {
  const buildPairs = samples.filter(
    (sample) =>
      typeof sample.predictedBuildDays === 'number' &&
      sample.predictedBuildDays > 0 &&
      typeof sample.actualBuildDays === 'number' &&
      sample.actualBuildDays > 0,
  );

  const confidencePairs = samples.filter(
    (sample) =>
      typeof sample.predictedConfidence === 'number' &&
      (SUCCESSFUL.has(sample.outcome) || UNSUCCESSFUL.has(sample.outcome)),
  );

  const sampleSize = new Set([...buildPairs, ...confidencePairs]).size;
  const notes: string[] = [];

  if (sampleSize < MINIMUM_SAMPLE) {
    return {
      sampleSize,
      buildEstimateRatio: null,
      confidenceBias: null,
      usable: false,
      refusal: refusalText(sampleSize),
      notes: [
        `${sampleSize} completed ${sampleSize === 1 ? 'project has' : 'projects have'} been recorded. Estimates are not being adjusted.`,
      ],
      buildSampleSize: buildPairs.length,
      confidenceSampleSize: confidencePairs.length,
    };
  }

  // The median rather than the mean: one project that ran five times over
  // should not become the system's expectation of every project.
  const ratios = buildPairs.map((sample) => sample.actualBuildDays! / sample.predictedBuildDays!);
  const buildEstimateRatio = ratios.length > 0 ? round(median(ratios)) : null;

  if (buildEstimateRatio !== null) {
    notes.push(
      buildEstimateRatio > 1.1
        ? `Builds have taken about ${buildEstimateRatio.toFixed(2)}× the estimate, across ${ratios.length} projects.`
        : buildEstimateRatio < 0.9
          ? `Builds have come in under estimate, at about ${buildEstimateRatio.toFixed(2)}× across ${ratios.length} projects.`
          : `Build estimates have held up, across ${ratios.length} projects.`,
    );
  }

  let confidenceBias: number | null = null;
  if (confidencePairs.length > 0) {
    const meanPredicted =
      confidencePairs.reduce((sum, sample) => sum + (sample.predictedConfidence ?? 0), 0) /
      confidencePairs.length;
    const observedSuccessRate =
      confidencePairs.filter((sample) => SUCCESSFUL.has(sample.outcome)).length / confidencePairs.length;

    confidenceBias = round(meanPredicted - observedSuccessRate);
    notes.push(
      confidenceBias > 0.1
        ? `Radar has been more confident than events justified, by about ${Math.round(confidenceBias * 100)} points across ${confidencePairs.length} decisions.`
        : confidenceBias < -0.1
          ? `Radar has been less confident than events justified, by about ${Math.round(-confidenceBias * 100)} points across ${confidencePairs.length} decisions.`
          : `Confidence has broadly matched outcomes across ${confidencePairs.length} decisions.`,
    );
  }

  return {
    sampleSize,
    buildEstimateRatio,
    confidenceBias,
    usable: true,
    refusal: null,
    notes,
    buildSampleSize: buildPairs.length,
    confidenceSampleSize: confidencePairs.length,
  };
}

function refusalText(sampleSize: number): string {
  const needed = MINIMUM_SAMPLE - sampleSize;
  return `Not enough history to calibrate against: ${sampleSize} of ${MINIMUM_SAMPLE} completed projects recorded, so ${needed} more ${needed === 1 ? 'is' : 'are'} needed before estimates are adjusted. Until then Radar uses its unadjusted estimates and says so.`;
}

/**
 * Applies the calibration to an estimate, or returns it untouched.
 *
 * Returning the original when calibration is unusable is deliberate: an
 * adjustment nobody can justify is worse than no adjustment, and the caller
 * gets told which happened.
 */
export function calibrateDays(
  estimateDays: number,
  calibration: CalibrationResult,
): { days: number; adjusted: boolean; explanation: string } {
  if (!calibration.usable || calibration.buildEstimateRatio === null) {
    return {
      days: estimateDays,
      adjusted: false,
      explanation: calibration.refusal ?? 'No build history to adjust against.',
    };
  }

  const days = round(estimateDays * calibration.buildEstimateRatio);
  return {
    days,
    adjusted: true,
    explanation: `Adjusted from ${estimateDays} by ${calibration.buildEstimateRatio.toFixed(2)}×, the median of ${calibration.buildSampleSize} of this team's own projects.`,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
