import { z } from 'zod';

/**
 * Environment parsing happens exactly once, at the composition root.
 * Nothing below `src/composition` reads `process.env`.
 */

const base64Key = z
  .string()
  .refine((value) => {
    try {
      return Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'must be 32 bytes encoded as base64');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (run `npm run db:up` for a local one)'),
  /**
   * Defaults to one connection.
   *
   * The embedded development database multiplexes every client connection onto
   * a single backend, so a transaction on one connection can interleave with a
   * query on another and desynchronise the protocol. One connection serialises
   * everything and is correct there. Raise it for a real PostgreSQL server --
   * see docs/DEPLOYMENT.md.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(1),
  RADAR_SECRET_KEY: base64Key.optional(),
  RADAR_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  RADAR_SINGLE_OWNER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RADAR_TICK_TOKEN: z.string().min(16).optional(),
  /**
   * Lets whoever built a handed-off opportunity report the outcome back.
   * Separate from the tick token on purpose: the two are given to different
   * parties, and neither should imply the other.
   */
  RADAR_FEEDBACK_TOKEN: z.string().min(16).optional(),
  /**
   * Machine-to-machine token for the personal Operating System bridge. The
   * endpoint is completely disabled when this is absent.
   */
  RADAR_OS_SYNC_TOKEN: z.string().min(24).optional(),
  /**
   * Optional explicit target for OS sync. Single-workspace installs do not need
   * it; Radar will resolve the only workspace. Set it before adding more
   * workspaces so a machine integration can never guess its tenant.
   */
  RADAR_OS_WORKSPACE_ID: z.string().uuid().optional(),
  RADAR_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  RADAR_CLOCK: z.string().optional(),
  /** Multiplies every rate limit. See docs/SECURITY.md before raising it. */
  RADAR_RATE_LIMIT_SCALE: z.coerce.number().min(0.1).max(1000).default(1),
  /** Only enable behind a proxy that overwrites x-forwarded-for. */
  RADAR_TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RADAR_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Forces the fixture provider regardless of what the database holds, so a
   * test run cannot reach a real provider by accident.
   */
  RADAR_AI_PROVIDER: z.enum(['configured', 'fixture']).default('configured'),
  RADAR_FIXTURE_DIR: z.string().optional(),
  RADAR_RECORD_FIXTURES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: clears the memoised environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
