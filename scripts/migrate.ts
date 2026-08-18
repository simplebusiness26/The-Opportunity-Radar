/** Applies pending migrations to DATABASE_URL. Safe to run repeatedly. */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/adapters/db/client';
import { loadEnv } from '../src/composition/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const handle = createDb(env.DATABASE_URL, 1);
  try {
    await migrate(handle.db, { migrationsFolder: 'src/adapters/db/migrations' });
    process.stdout.write('opportunity-radar: migrations applied\n');
  } finally {
    await handle.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`opportunity-radar: migration failed\n${String(error)}\n`);
  process.exit(1);
});
