/**
 * Embedded PostgreSQL for local development and CI.
 *
 * PGlite is a single-process WASM Postgres with an exclusive lock on its data
 * directory. Running it in-process would mean the Next dev server, the worker
 * and vitest all fight over that lock, and it would leave the dev code path
 * (drizzle-orm/pglite) different from the production one (node-postgres).
 *
 * Instead we serve it over the real PostgreSQL wire protocol. Everything —
 * app, worker, tests, drizzle-kit, psql — connects with `pg` and DATABASE_URL,
 * so development, CI and production share one driver and one code path.
 * Pointing DATABASE_URL at a real PostgreSQL server needs no code change.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { fuzzystrmatch } from '@electric-sql/pglite/contrib/fuzzystrmatch';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const DATA_DIR = resolve(process.env.RADAR_DATA_DIR ?? '.data/pg');
const PORT = Number(process.env.RADAR_DB_PORT ?? 5433);
const HOST = process.env.RADAR_DB_HOST ?? '127.0.0.1';
// PGlite has a single backend; the socket server multiplexes clients over it and
// queues at the query level. Connections must exceed the sum of every pool that
// connects concurrently (app + worker + test runner), or clients get dropped.
//
// Note that multiplexing does not make concurrent transactions safe: two
// connections interleaving on one backend desynchronise the wire protocol.
// Clients therefore run a single connection each (see DATABASE_POOL_MAX).
const MAX_CONNECTIONS = Number(process.env.RADAR_DB_MAX_CONNECTIONS ?? 40);

async function main(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });

  const db = await PGlite.create({
    dataDir: DATA_DIR,
    extensions: { citext, fuzzystrmatch, pg_trgm, pgcrypto },
  });

  // Extensions the schema depends on. Created once; harmless when repeated.
  for (const ext of ['citext', 'pg_trgm', 'fuzzystrmatch', 'pgcrypto']) {
    await db.exec(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
  }

  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: HOST,
    maxConnections: MAX_CONNECTIONS,
  });
  await server.start();

  process.stdout.write(
    `opportunity-radar: embedded postgres listening on ${HOST}:${PORT}\n` +
      `  data dir        ${DATA_DIR}\n` +
      `  max connections ${MAX_CONNECTIONS}\n` +
      `  DATABASE_URL    postgres://radar:radar@${HOST}:${PORT}/postgres\n`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\nopportunity-radar: ${signal} received, closing database...\n`);
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error: unknown) => {
  process.stderr.write(`opportunity-radar: database server failed to start\n${String(error)}\n`);
  process.exit(1);
});
