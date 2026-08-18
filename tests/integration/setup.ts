/**
 * Integration tests run against the embedded PostgreSQL wire server, i.e. the
 * same driver and SQL dialect production uses. Set POSTGRES_TEST_URL to run the
 * identical suite against a real PostgreSQL instance and surface any divergence.
 */
import { beforeAll } from 'vitest';
import { migrateTestDatabase } from './helpers/db';

beforeAll(async () => {
  await migrateTestDatabase();
}, 120_000);
