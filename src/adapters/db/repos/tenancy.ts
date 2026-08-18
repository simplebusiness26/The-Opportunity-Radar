import { eq, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { memberships, orgs, workspaces } from '../schema/index';
import type { MemberRole } from '../../../domain/types/identity';
import type { TenancyRepository, WorkspaceSummary } from '../../../ports/repositories/auth';
import { slugify } from '../../../domain/text/slug';

export async function insertOrg(db: Executor, name: string, slug: string) {
  const [row] = await db.insert(orgs).values({ name, slug }).returning();
  if (!row) throw new Error('insertOrg returned no row');
  return row;
}

export async function insertWorkspace(db: Executor, orgId: string, name: string, slug: string) {
  const [row] = await db.insert(workspaces).values({ orgId, name, slug }).returning();
  if (!row) throw new Error('insertWorkspace returned no row');
  return row;
}

export async function insertMembership(
  db: Executor,
  input: { orgId: string; workspaceId: string; userId: string; role: MemberRole },
) {
  const [row] = await db.insert(memberships).values(input).returning();
  if (!row) throw new Error('insertMembership returned no row');
  return row;
}

export async function findWorkspace(db: Executor, workspaceId: string) {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return rows[0] ?? null;
}

export async function updateWorkspaceSettings(
  db: Executor,
  workspaceId: string,
  settings: Record<string, unknown>,
  now: Date,
) {
  await db
    .update(workspaces)
    .set({ settings, updatedAt: now })
    .where(eq(workspaces.id, workspaceId));
}

/** Slugs are derived from names and made unique with a numeric suffix. */
export async function uniqueSlug(db: Executor, table: 'orgs' | 'workspaces', base: string) {
  const seed = slugify(base) || 'workspace';
  const target = table === 'orgs' ? orgs : workspaces;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed}-${attempt + 1}`;
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(target)
      .where(eq(target.slug, candidate));
    if ((existing[0]?.count ?? 0) === 0) return candidate;
  }
  throw new Error(`Could not derive a unique slug from "${base}"`);
}


function toSummary(row: {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  settings: unknown;
}): WorkspaceSummary {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    settings: (row.settings ?? {}) as Record<string, unknown>,
  };
}

export function createTenancyRepository(db: Executor): TenancyRepository {
  return {
    createOrg: async (name, slug) => {
      const row = await insertOrg(db, name, slug);
      return { id: row.id, name: row.name, slug: row.slug };
    },
    createWorkspace: async (orgId, name, slug) => toSummary(await insertWorkspace(db, orgId, name, slug)),
    createMembership: async (input) => {
      await insertMembership(db, input);
    },
    findWorkspace: async (workspaceId) => {
      const row = await findWorkspace(db, workspaceId);
      return row ? toSummary(row) : null;
    },
    updateSettings: (workspaceId, settings, now) =>
      updateWorkspaceSettings(db, workspaceId, settings, now),
    uniqueSlug: (table, base) => uniqueSlug(db, table, base),
  };
}
