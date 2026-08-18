import { NextResponse } from 'next/server';
import { HTTP_STATUS_BY_KIND, isRadarError, RadarError } from '../../domain/types/errors';

/**
 * One response shape for the whole API. Every route returns either
 * `{ data }` or `{ error }`; there is no third form to handle on the client.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Concrete next step when there is one, e.g. which credential to add. */
    remedy?: string;
    details?: unknown;
    requestId?: string;
  };
}

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function apiCreated<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function apiNoContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Converts any thrown value into a safe response. Unrecognised errors become a
 * generic 500: internal messages, stack traces and driver errors never reach a
 * client, and the detail is logged server-side instead.
 */
export function apiError(error: unknown, requestId?: string): NextResponse {
  const radar = toRadarError(error);
  const status = HTTP_STATUS_BY_KIND[radar.kind];

  const body: ApiErrorBody = {
    error: {
      code: radar.code,
      message: radar.publicMessage,
      ...(radar.remedy ? { remedy: radar.remedy } : {}),
      ...(radar.details !== undefined ? { details: radar.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };

  const headers = new Headers();
  if (radar.kind === 'rate_limited') {
    const retryAfter = (radar.details as { retryAfterSeconds?: number } | undefined)
      ?.retryAfterSeconds;
    if (retryAfter) headers.set('Retry-After', String(retryAfter));
  }

  if (radar.kind === 'internal') {
    console.error('[radar] unhandled error', {
      requestId,
      code: radar.code,
      message: radar.message,
      cause: radar.cause,
    });
  }

  return NextResponse.json(body, { status, headers });
}

function toRadarError(error: unknown): RadarError {
  if (isRadarError(error)) return error;

  // zod failures carry field-level detail that is safe and useful to return.
  if (isZodLike(error)) {
    return new RadarError({
      kind: 'validation',
      code: 'validation.failed',
      message: 'Some fields need attention.',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return new RadarError({
    kind: 'internal',
    code: 'internal.unhandled',
    message: error instanceof Error ? error.message : String(error),
    publicMessage: 'Something went wrong on our side.',
    cause: error,
  });
}

function isZodLike(
  value: unknown,
): value is { issues: Array<{ path: Array<string | number>; message: string }> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'issues' in value &&
    Array.isArray((value as { issues: unknown }).issues)
  );
}
