import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Primary key used by every table: a database-generated UUID v4. */
export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

/** A timestamptz column. Radar stores every instant in UTC. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () => ts('updated_at').notNull().defaultNow();
