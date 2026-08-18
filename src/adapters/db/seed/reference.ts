import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { signalTypes } from '../schema/index';
import { SIGNAL_TYPES } from '../../../domain/taxonomy/signal-types';

/**
 * Reference data the schema depends on.
 *
 * The taxonomy lives in code -- that is where the maths is -- but the database
 * needs the rows so signals can carry a foreign key, and so an owner can later
 * add a type of their own without a deployment. Idempotent, and safe to run on
 * every startup and every migration.
 */
export async function seedReferenceData(db: Database): Promise<void> {
  const values = Object.values(SIGNAL_TYPES).map((definition) => ({
    key: definition.key,
    label: definition.label,
    description: definition.description,
    baseStrength: definition.baseStrength,
    defaultHalfLifeDays: definition.halfLifeDays,
    decayMode: definition.decayMode,
    builtin: true,
    workspaceId: null,
  }));

  await db
    .insert(signalTypes)
    .values(values)
    .onConflictDoUpdate({
      target: signalTypes.key,
      set: {
        label: sql`excluded.label`,
        description: sql`excluded.description`,
        baseStrength: sql`excluded.base_strength`,
        defaultHalfLifeDays: sql`excluded.default_half_life_days`,
        decayMode: sql`excluded.decay_mode`,
      },
    });
}
