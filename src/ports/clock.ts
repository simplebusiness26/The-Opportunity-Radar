/**
 * Time is an injected dependency. `Date.now()` and `new Date()` are banned
 * everywhere except `src/adapters/clock` (enforced by eslint + dependency
 * rules) so that scoring, decay, scheduling and tests are all deterministic.
 */
export interface Clock {
  now(): Date;
  /** Milliseconds since the epoch. */
  epochMs(): number;
}
