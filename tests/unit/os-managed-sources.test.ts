import { describe, expect, it } from 'vitest';
import { deriveOsWatchQueries } from '../../src/application/integrations/os-managed-sources';

describe('OS-managed free source watchlist', () => {
  it('prioritizes goals, then useful project/capability context', () => {
    const queries = deriveOsWatchQueries({
      goals: [
        { name: 'Build an autonomous AI operations command centre', priority: 10, target: 'near term revenue' },
        { name: 'Find high leverage software opportunities', priority: 8, target: null },
      ],
      projects: [
        {
          name: 'ClipMine',
          summary: 'AI video clipping for creators and social publishing. Primary language: TypeScript.',
          goal: 'Turn long videos into useful short clips automatically',
        },
      ],
      capabilities: [
        { name: 'AI assisted web application development', capability: 'full_stack_web' },
      ],
    });

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(queries[0]?.toLowerCase()).toContain('autonomous');
    expect(queries.some((query) => query.toLowerCase().includes('video'))).toBe(true);
  });

  it('ignores metadata-only summaries and removes duplicate watch phrases', () => {
    const queries = deriveOsWatchQueries({
      goals: [
        { name: 'AI workflow automation', priority: 9, target: null },
        { name: 'AI workflow automation', priority: 8, target: null },
      ],
      projects: [
        { name: 'One', summary: 'Primary language: TypeScript.', goal: '' },
        { name: 'Two', summary: 'Homepage: https://example.com', goal: '' },
      ],
      capabilities: [
        { name: 'AI workflow automation', capability: 'automation' },
      ],
    });

    expect(queries).toEqual(['AI workflow automation']);
  });
});
