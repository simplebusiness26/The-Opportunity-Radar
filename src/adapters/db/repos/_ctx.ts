import type { Database } from '../client';

/**
 * Repositories accept either the pool-backed database or an open transaction,
 * so a use-case can compose several writes atomically without the repository
 * needing to know which it received. Domain events are appended in the same
 * transaction as the write that produced them.
 */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
