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
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  RADAR_SECRET_KEY: base64Key.optional(),
  RADAR_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  RADAR_SINGLE_OWNER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RADAR_TICK_TOKEN: z.string().min(16).optional(),
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
