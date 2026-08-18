/**
 * Normalisers map a raw measurement onto 0-1.
 *
 * They are separated from the dimensions so the shape of each curve is visible
 * and testable on its own: whether a score saturates, and how quickly, is a
 * judgement worth being able to inspect.
 */

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Straight line between two points, flat outside them. */
export function linear(value: number, min: number, max: number): number {
  if (max === min) return value >= max ? 1 : 0;
  return clamp((value - min) / (max - min));
}

/**
 * Diminishing returns. The third independent source matters far more than the
 * thirtieth, and a linear count would let volume masquerade as certainty.
 */
export function saturating(value: number, halfPoint: number): number {
  if (value <= 0) return 0;
  if (halfPoint <= 0) return 1;
  return value / (value + halfPoint);
}

/** Compresses wide ranges, for money and time spans. */
export function logarithmic(value: number, min: number, max: number): number {
  if (value <= 0) return 0;
  const lo = Math.log10(Math.max(min, 1));
  const hi = Math.log10(Math.max(max, min + 1));
  return clamp((Math.log10(value) - lo) / (hi - lo));
}

/** S-curve for measures with a natural indifference point. */
export function logistic(value: number, midpoint: number, steepness = 1): number {
  return 1 / (1 + Math.exp(-steepness * (value - midpoint)));
}

/** Maps an ordered set of labels onto evenly spaced values. */
export function ordinal<T extends string>(value: T, order: readonly T[]): number {
  const index = order.indexOf(value);
  if (index < 0) return 0;
  return order.length === 1 ? 1 : index / (order.length - 1);
}

/** Reverses a normalised value, for measures where less is better. */
export function invert(value: number): number {
  return clamp(1 - value);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
