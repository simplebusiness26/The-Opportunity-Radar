import type { Clock } from '../../ports/clock';

export const systemClock: Clock = {
  now: () => new Date(),
  epochMs: () => Date.now(),
};

/** A clock frozen at a fixed instant. Used by tests and `RADAR_CLOCK=fixed:...`. */
export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at.getTime()), epochMs: () => at.getTime() };
}

/**
 * A clock that starts at `at` and only moves when explicitly advanced.
 * Lets tests exercise decay, leases and backoff without sleeping.
 */
export function controllableClock(at: Date): Clock & { advance(ms: number): void; set(to: Date): void } {
  let current = at.getTime();
  return {
    now: () => new Date(current),
    epochMs: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (to: Date) => {
      current = to.getTime();
    },
  };
}

/** Builds the clock described by `RADAR_CLOCK` (`fixed:<iso>` or unset). */
export function clockFromEnv(spec: string | undefined): Clock {
  if (!spec || spec === 'system') return systemClock;
  if (spec.startsWith('fixed:')) {
    const iso = spec.slice('fixed:'.length);
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
      throw new Error(`RADAR_CLOCK is not a valid instant: ${iso}`);
    }
    return fixedClock(at);
  }
  throw new Error(`RADAR_CLOCK must be "system" or "fixed:<iso8601>", got: ${spec}`);
}
