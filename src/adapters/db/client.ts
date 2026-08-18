import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * One driver everywhere. In development `DATABASE_URL` points at the embedded
 * PGlite wire server (`npm run db:up`); in production it points at a real
 * PostgreSQL instance. No branch in the code distinguishes them.
 */
export function createDb(databaseUrl: string, poolMax = 10): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: poolMax,
    // PGlite multiplexes a single backend; keeping connections short-lived
    // avoids holding its only session open across idle periods.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'opportunity-radar',
  });

  const db = drizzle(pool, { schema, casing: 'snake_case' });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * Process-wide handle for the Next.js server, which must not open a new pool on
 * every hot reload.
 */
const globalRef = globalThis as { __radarDb?: DbHandle };

export function sharedDb(databaseUrl: string, poolMax = 10): DbHandle {
  globalRef.__radarDb ??= createDb(databaseUrl, poolMax);
  return globalRef.__radarDb;
}
