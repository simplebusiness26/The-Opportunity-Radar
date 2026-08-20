import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      '.data/**',
      'src/adapters/db/migrations/**',
      '*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly' },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Time must be injected so scoring, decay, scheduling and tests stay
    // deterministic. src/adapters/clock is the single sanctioned exception.
    files: ['src/**/*.ts', 'src/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'],
    ignores: ['src/adapters/clock/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use the injected Clock port instead of Date.now().',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock port instead of new Date().',
        },
      ],
    },
  },
  {
    // Standalone Node scripts at the repository root (tooling bridges and the
    // like) run with the Node globals rather than the app's module graph.
    files: ['*.mjs'],
    ignores: ['eslint.config.mjs'],
    languageOptions: {
      globals: {
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    // Revenue Hunter is a separate Worker-style subsystem that shares this
    // repository but not Radar's runtime. Recognise its Worker/web globals and
    // avoid applying TypeScript-only cleanliness rules to its plain .mjs files.
    // This changes lint interpretation only; it does not alter Revenue Hunter logic.
    files: ['systems/revenue-hunter/**/*.mjs'],
    languageOptions: {
      globals: {
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Response: 'readonly',
        crypto: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        btoa: 'readonly',
      },
    },
    rules: {
      'no-useless-escape': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Revenue Hunter's doctor/dry-run commands are terminal programs; printing
    // their result is their interface. This lint exception does not change the
    // Revenue Hunter runtime or its decision/scoring logic.
    files: ['systems/revenue-hunter/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // The service worker runs in a worker global scope, not a page.
    files: ['public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        clients: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
);
