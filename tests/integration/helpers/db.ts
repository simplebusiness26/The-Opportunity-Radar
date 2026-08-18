import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../../../src/adapters/db/client';
import { seedReferenceData } from '../../../src/adapters/db/seed/reference';

export const TEST_DATABASE_URL =
  process.env.POSTGRES_TEST_URL ??
  process.env.DATABASE_URL ??
  'postgres://radar:radar@127.0.0.1:5433/postgres';

let handle: DbHandle | undefined;

export function testDb(): DbHandle {
  handle ??= createDb(TEST_DATABASE_URL, 4);
  return handle;
}

export async function migrateTestDatabase(): Promise<void> {
  await migrate(testDb().db, { migrationsFolder: 'src/adapters/db/migrations' });
  await seedReferenceData(testDb().db);
}

/**
 * PGlite has no usable CREATE DATABASE, so isolation is by truncation rather
 * than by database-per-worker. The table list is read from the catalogue so a
 * new table is covered the moment it is created.
 */
export async function resetTestDatabase(): Promise<void> {
  const { db } = testDb();
  const result = await db.execute<{ tables: string | null }>(sql`
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('__drizzle_migrations', 'signal_types')
  `);
  const tables = result.rows[0]?.tables;
  if (!tables) return;
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  // Reference data is not test fixture data; it must survive a reset.
  await seedReferenceData(db);
}

export async function closeTestDatabase(): Promise<void> {
  await handle?.close();
  handle = undefined;
}
