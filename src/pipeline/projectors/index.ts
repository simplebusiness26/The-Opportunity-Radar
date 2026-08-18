/**
 * Projection: turning validated model output into rows.
 *
 * Schema validation proves the output has the right *shape*. It says nothing
 * about whether the contents are true, in range, or referring to things that
 * exist. This layer is where that is enforced, and it is the reason a model
 * cannot corrupt the database however badly it behaves:
 *
 *   - numbers are clamped to their declared range rather than trusted;
 *   - enum values outside the known set are dropped, not stored;
 *   - every citation must name evidence that was actually supplied, so a
 *     hallucinated source is discarded and counted rather than persisted.
 *
 * Everything dropped is counted and surfaced, so a model that habitually
 * invents citations becomes visible rather than quietly shaping the scores.
 */

export interface ProjectionReport {
  /** Values clamped into range. */
  clamped: string[];
  /** Enum values that were not recognised. */
  droppedValues: string[];
  /** Citations naming evidence that was never supplied. */
  hallucinatedCitations: string[];
  /** Claims discarded because nothing they cited survived. */
  droppedClaims: number;
}

export function emptyReport(): ProjectionReport {
  return { clamped: [], droppedValues: [], hallucinatedCitations: [], droppedClaims: 0 };
}

export function clampNumber(
  value: number,
  range: { min: number; max: number },
  field: string,
  report: ProjectionReport,
): number {
  if (!Number.isFinite(value)) {
    report.clamped.push(`${field} was not a number`);
    return range.min;
  }
  if (value < range.min || value > range.max) {
    report.clamped.push(`${field} was ${value}, clamped to ${range.min}-${range.max}`);
    return Math.min(range.max, Math.max(range.min, value));
  }
  return value;
}

export function acceptEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
  report: ProjectionReport,
): T | null {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  report.droppedValues.push(`${field}: "${value}" is not a recognised value`);
  return null;
}

export interface CitedInput {
  claim: string;
  signalIds: string[];
  confidence: number;
}

export interface ProjectedClaim {
  claim: string;
  signalIds: string[];
  confidence: number;
}

/**
 * Keeps only claims that cite evidence which was actually in the prompt.
 *
 * This is the core anti-hallucination mechanism, and it is deliberately blunt:
 * a claim whose every citation is invented is discarded outright, because an
 * unsupported claim entering the evidence base is exactly what the product
 * exists to prevent.
 */
export function projectClaims(
  claims: readonly CitedInput[],
  suppliedSignalIds: readonly string[],
  report: ProjectionReport,
  options: { requireCitation?: boolean } = {},
): ProjectedClaim[] {
  const supplied = new Set(suppliedSignalIds);
  const requireCitation = options.requireCitation ?? true;
  const projected: ProjectedClaim[] = [];

  for (const claim of claims) {
    const kept: string[] = [];

    for (const signalId of claim.signalIds) {
      if (supplied.has(signalId)) kept.push(signalId);
      else report.hallucinatedCitations.push(signalId);
    }

    if (requireCitation && kept.length === 0) {
      report.droppedClaims += 1;
      continue;
    }

    projected.push({
      claim: claim.claim.trim().slice(0, 1000),
      signalIds: kept,
      confidence: clampNumber(claim.confidence, { min: 0, max: 1 }, 'claim.confidence', report),
    });
  }

  return projected;
}

/** Whether a projection found enough wrong to be worth telling someone about. */
export function isReportNotable(report: ProjectionReport): boolean {
  return (
    report.hallucinatedCitations.length > 0 ||
    report.droppedClaims > 0 ||
    report.droppedValues.length > 0
  );
}

export function describeReport(report: ProjectionReport): string {
  const parts: string[] = [];
  if (report.droppedClaims > 0) {
    parts.push(`${report.droppedClaims} claim(s) discarded for citing evidence that was not supplied`);
  }
  if (report.hallucinatedCitations.length > 0) {
    parts.push(`${report.hallucinatedCitations.length} invented citation(s) removed`);
  }
  if (report.droppedValues.length > 0) parts.push(`${report.droppedValues.length} unrecognised value(s) dropped`);
  if (report.clamped.length > 0) parts.push(`${report.clamped.length} value(s) clamped into range`);

  return parts.length ? parts.join('; ') : 'Nothing needed correcting.';
}
