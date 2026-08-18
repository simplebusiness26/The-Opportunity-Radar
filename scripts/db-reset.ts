/**
 * Empties every table and restores the reference data.
 *
 * Development only, and it says so: this deletes every workspace, every piece
 * of evidence and every decision in the target database. It refuses to run
 * against anything that does not look local unless RADAR_ALLOW_DESTRUCTIVE_RESET
 * is set, because the cost of getting this wrong is somebody's entire evidence
 * base.
 *
 * It truncates rather than dropping the schema. Dropping it would take the
 * extensions with it -- they live in `public` -- and the next migration would
 * fail on a missing `gen_random_uuid`. To rebuild the schema itself, delete the
 * PGlite data directory and run `db:migrate`.
 */
import { sql } from 'drizzle-orm';
import { loadEnvFile } from '../src/composition/load-env-file';
import { createDb } from '../src/adapters/db/client';
import { seedReferenceData } from '../src/adapters/db/seed/reference';

const LOCAL = /(^|@|\/\/)(127\.0\.0\.1|localhost)(:|\/)/;

async function main(): Promise<void> {
  loadEnvFile();
  const url = process.env.DATABASE_URL ?? 'postgres://radar:radar@127.0.0.1:5433/postgres';

  if (!LOCAL.test(url) && process.env.RADAR_ALLOW_DESTRUCTIVE_RESET !== 'true') {
    process.stderr.write(
      'db:reset refuses to run against a database that is not local.\n' +
        'Set RADAR_ALLOW_DESTRUCTIVE_RESET=true if you genuinely mean to erase it.\n',
    );
    process.exit(1);
  }

  const handle = createDb(url, 1);

  // Read from the catalogue rather than a hand-kept list, so a table added
  // tomorrow is covered without anyone remembering to add it here.
  const result = await handle.db.execute<{ tables: string | null }>(sql`
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `);

  const tables = result.rows[0]?.tables;
  if (tables) {
    process.stdout.write('opportunity-radar: emptying every table\n');
    await handle.db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  }

  // Reference data is not fixture data; it must survive a reset.
  await seedReferenceData(handle.db);

  await handle.close();
  process.stdout.write('opportunity-radar: reset complete\n');
}

await main();
