import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/adapters/db/schema/index.ts',
  out: './src/adapters/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://radar:radar@127.0.0.1:5433/postgres',
  },
  strict: true,
  verbose: false,
});
