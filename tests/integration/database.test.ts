import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { orgs, workspaces } from '../../src/adapters/db/schema/index';
import { resetTestDatabase, testDb } from './helpers/db';

describe('database rails', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('runs the extensions the dedupe and crypto layers depend on', async () => {
    const { db } = testDb();
    const result = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension ORDER BY extname`,
    );
    const installed = result.rows.map((row) => row.extname);
    expect(installed).toEqual(expect.arrayContaining(['citext', 'pg_trgm', 'fuzzystrmatch', 'pgcrypto']));
  });

  it('supports the SQL the job queue relies on', async () => {
    const { db } = testDb();
    // `FOR UPDATE SKIP LOCKED` is how workers claim jobs without a lock server.
    await expect(
      db.execute(sql`SELECT 1 FROM orgs WHERE false FOR UPDATE SKIP LOCKED`),
    ).resolves.toBeDefined();
  });

  it('enforces the workspace -> org foreign key', async () => {
    const { db } = testDb();
    await expect(
      db.insert(workspaces).values({
        orgId: '00000000-0000-4000-8000-000000000000',
        name: 'Orphan',
        slug: 'orphan',
      }),
    ).rejects.toThrow();
  });

  it('cascades workspace deletion from its org', async () => {
    const { db } = testDb();
    const [org] = await db.insert(orgs).values({ name: 'Acme', slug: 'acme' }).returning();
    expect(org).toBeDefined();
    await db.insert(workspaces).values({ orgId: org!.id, name: 'Default', slug: 'default' });

    await db.delete(orgs).where(sql`${orgs.id} = ${org!.id}`);
    const remaining = await db.select().from(workspaces);
    expect(remaining).toEqual([]);
  });
});
