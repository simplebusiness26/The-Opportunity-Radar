import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A second, independent guard on the module boundaries.
 *
 * dependency-cruiser already enforces these rules, but it is configuration —
 * if it is misconfigured or silently skipped in CI, the boundaries rot without
 * anyone noticing. This test reads the source directly, so it fails even then.
 */

const ROOT = new URL('../..', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'migrations') continue;
        walk(full);
      } else if (['.ts', '.tsx'].includes(extname(entry))) {
        out.push(full);
      }
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** Removes comments and string literals so prose about a rule never trips it. */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((match = bare.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

function violations(dir: string, forbidden: RegExp[]): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(dir)) {
    for (const specifier of importsOf(file)) {
      if (forbidden.some((rule) => rule.test(specifier))) {
        found.push(`${relative(ROOT, file)} imports ${specifier}`);
      }
    }
  }
  return found;
}

describe('module boundaries', () => {
  it('keeps src/domain free of IO, frameworks and persistence', () => {
    expect(
      violations('src/domain', [
        /^next(\/|$)/,
        /^react(-dom)?(\/|$)/,
        /^drizzle-orm(\/|$)/,
        /^pg(\/|$)/,
        /^node:(fs|http|https|net|dns|child_process)$/,
        /\.\.\/(adapters|application|pipeline|jobs|web|composition)\//,
      ]),
    ).toEqual([]);
  });

  it('keeps src/ports free of implementations', () => {
    expect(
      violations('src/ports', [/\.\.\/(adapters|application|pipeline|jobs|web|composition)\//]),
    ).toEqual([]);
  });

  it('confines the ORM and the database driver to src/adapters/db', () => {
    const offenders = [...sourceFiles('src'), ...sourceFiles('app')]
      .filter((file) => !file.includes('/adapters/db/'))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => /^(drizzle-orm|pg)(\/|$)/.test(specifier))
          .map((specifier) => `${relative(ROOT, file)} imports ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });

  it('confines next and react to app/ and src/web', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !file.includes('/web/'))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => /^(next|react|react-dom)(\/|$)/.test(specifier))
          .map((specifier) => `${relative(ROOT, file)} imports ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe('time is injected', () => {
  it('has no direct clock access outside src/adapters/clock', () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles('src'), ...sourceFiles('app')]) {
      if (file.includes('/adapters/clock/')) continue;
      const source = stripNonCode(readFileSync(file, 'utf8'));
      if (/\bDate\.now\s*\(/.test(source) || /\bnew Date\s*\(\s*\)/.test(source)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
