/**
 * The relational model. This file is the contract every other module reads.
 * It is the only place in the repository that defines database structure;
 * migrations under ./migrations are generated from it by drizzle-kit.
 */
export * from './_shared';
export * from './tenancy';
export * from './audit';
export * from './intelligence';
export * from './opportunities';
export * from './ops';
export * from './graph';
export * from './ai';
export * from './sources';
export * from './investigation';
export * from './memory';
export * from './execution';
