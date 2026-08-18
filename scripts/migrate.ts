/** Applies pending migrations to DATABASE_URL. Safe to run repeatedly. */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/adapters/db/client';
import { seedReferenceData } from '../src/adapters/db/seed/reference';
import { loadEnv } from '../src/composition/env';
import { loadEnvFile } from '../src/composition/load-env-file';

async function main(): Promise<void> {
  loadEnvFile();
  const env = loadEnv();
  const handle = createDb(env.DATABASE_URL, 1);
  try {
    await migrate(handle.db, { migrationsFolder: 'src/adapters/db/migrations' });
    // Reference rows the schema depends on. Idempotent, so this stays correct
    // whether the database is new or already in service.
    await seedReferenceData(handle.db);
    process.stdout.write('opportunity-radar: migrations applied\n');
  } finally {
    await handle.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`opportunity-radar: migration failed\n${String(error)}\n`);
  process.exit(1);
});
