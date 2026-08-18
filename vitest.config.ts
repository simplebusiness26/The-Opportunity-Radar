import { defineConfig } from 'vitest/config';

const alias = {
  '@/domain': new URL('./src/domain', import.meta.url).pathname,
  '@/ports': new URL('./src/ports', import.meta.url).pathname,
  '@/adapters': new URL('./src/adapters', import.meta.url).pathname,
  '@/application': new URL('./src/application', import.meta.url).pathname,
  '@/pipeline': new URL('./src/pipeline', import.meta.url).pathname,
  '@/jobs': new URL('./src/jobs', import.meta.url).pathname,
  '@/composition': new URL('./src/composition', import.meta.url).pathname,
  '@/tests': new URL('./tests', import.meta.url).pathname,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          // PGlite serves a single backend; integration files must not race.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'eval',
          include: ['tests/eval/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
    ],
  },
});
