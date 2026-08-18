/**
 * A closed set of failure kinds. Every one maps to exactly one HTTP status at
 * the API boundary, so no route invents its own error shape and no internal
 * message leaks to a client by accident.
 */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'rate_limited'
  | 'not_configured'
  | 'budget_exceeded'
  | 'upstream_failed'
  | 'internal';

export class RadarError extends Error {
  readonly kind: ErrorKind;
  /** Stable machine-readable code, e.g. `opportunity.illegal_transition`. */
  readonly code: string;
  /** Safe to show a user. Never contains internal detail. */
  readonly publicMessage: string;
  readonly details?: unknown;
  /** What the owner should do about it, when there is a concrete answer. */
  readonly remedy?: string;

  constructor(options: {
    kind: ErrorKind;
    code: string;
    message: string;
    publicMessage?: string;
    details?: unknown;
    remedy?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'RadarError';
    this.kind = options.kind;
    this.code = options.code;
    this.publicMessage = options.publicMessage ?? options.message;
    this.details = options.details;
    this.remedy = options.remedy;
  }
}

export const errors = {
  validation: (code: string, message: string, details?: unknown) =>
    new RadarError({ kind: 'validation', code, message, details }),

  unauthenticated: (message = 'Sign in to continue.') =>
    new RadarError({ kind: 'unauthenticated', code: 'auth.required', message }),

  forbidden: (code = 'auth.forbidden', message = 'You do not have access to this.') =>
    new RadarError({ kind: 'forbidden', code, message }),

  notFound: (entity: string) =>
    new RadarError({
      kind: 'not_found',
      code: `${entity}.not_found`,
      message: `${entity} not found.`,
    }),

  conflict: (code: string, message: string) =>
    new RadarError({ kind: 'conflict', code, message }),

  preconditionFailed: (code: string, message: string, remedy?: string) =>
    new RadarError({ kind: 'precondition_failed', code, message, remedy }),

  rateLimited: (retryAfterSeconds: number) =>
    new RadarError({
      kind: 'rate_limited',
      code: 'rate_limited',
      message: 'Too many requests.',
      details: { retryAfterSeconds },
    }),

  /**
   * The feature exists and is wired up, but the owner has not connected the
   * service it needs. The remedy is always actionable.
   */
  notConfigured: (code: string, message: string, remedy: string) =>
    new RadarError({ kind: 'not_configured', code, message, remedy }),

  budgetExceeded: (message: string, details?: unknown) =>
    new RadarError({ kind: 'budget_exceeded', code: 'budget.exceeded', message, details }),

  upstreamFailed: (code: string, message: string, cause?: unknown) =>
    new RadarError({ kind: 'upstream_failed', code, message, cause }),

  internal: (code: string, message: string, cause?: unknown) =>
    new RadarError({
      kind: 'internal',
      code,
      message,
      publicMessage: 'Something went wrong on our side.',
      cause,
    }),
};

export function isRadarError(value: unknown): value is RadarError {
  return value instanceof RadarError;
}

export const HTTP_STATUS_BY_KIND: Record<ErrorKind, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,
  not_configured: 503,
  budget_exceeded: 402,
  upstream_failed: 502,
  internal: 500,
};
