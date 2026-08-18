/**
 * Architectural boundaries, enforced in CI.
 *
 * The dependency direction is:
 *   app/ + src/web  ->  src/jobs -> src/pipeline -> src/application -> src/domain
 *                                                        \-> src/ports <- src/adapters
 *
 * `src/domain` is pure: no IO, no framework, no database, no clock. That purity
 * is what makes the scoring, dedupe and decay engines exhaustively testable.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'src/domain must contain only pure functions over DTOs. No IO, no framework, no ORM, no clock.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        path: '^(src/(adapters|application|pipeline|jobs|web|composition|worker)|app/)|^(next|react|react-dom|drizzle-orm|pg|node:fs|node:http|node:https|node:net|node:dns)$',
      },
    },
    {
      name: 'ports-are-interfaces',
      comment: 'src/ports declares contracts only; it must not depend on implementations.',
      severity: 'error',
      from: { path: '^src/ports' },
      to: { path: '^src/(adapters|application|pipeline|jobs|web|composition)|^app/' },
    },
    {
      name: 'application-uses-ports-not-adapters',
      comment:
        'src/application receives its dependencies through ports from the composition root; it must never import a concrete adapter.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/(adapters|web|jobs)|^app/' },
    },
    {
      name: 'only-db-adapter-uses-orm',
      comment: 'drizzle-orm and pg are confined to src/adapters/db.',
      severity: 'error',
      from: { pathNot: '^(src/adapters/db|scripts|drizzle\\.config\\.ts|tests)' },
      to: { path: '^(drizzle-orm|pg)($|/)' },
    },
    {
      name: 'only-web-uses-framework',
      comment: 'next and react are confined to app/ and src/web.',
      severity: 'error',
      from: { pathNot: '^(app/|src/web/|next\\.config\\.ts)' },
      to: { path: '^(next|react|react-dom)($|/)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: '\\.d\\.ts$|(^|/)(index|layout|page|route)\\.tsx?$' },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$|^tests/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
