/**
 * A robots.txt reader.
 *
 * Radar respects robots because it is reading other people's sites on a
 * schedule, and a crawler that ignores the file is a crawler that eventually
 * gets blocked -- and deserves to be. Parsing is deliberately conservative:
 * anything ambiguous is treated as disallowed.
 */

export interface RobotsRule {
  path: string;
  allow: boolean;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
  /** True when the file could not be read and we are guessing. */
  assumed: boolean;
}

export const PERMISSIVE: RobotsPolicy = { rules: [], crawlDelaySeconds: null, assumed: true };

export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const lines = text.split(/\r?\n/);

  const groups: Array<{ agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;

    if (field === 'allow') current.rules.push({ path: value, allow: true });
    else if (field === 'disallow') current.rules.push({ path: value, allow: false });
    else if (field === 'crawl-delay') {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
    }
  }

  const agent = userAgent.toLowerCase();
  const specific = groups.find((group) =>
    group.agents.some((candidate) => candidate !== '*' && agent.includes(candidate)),
  );
  const wildcard = groups.find((group) => group.agents.includes('*'));
  const chosen = specific ?? wildcard;

  if (!chosen) return { rules: [], crawlDelaySeconds: null, assumed: false };

  return {
    rules: chosen.rules,
    crawlDelaySeconds: chosen.crawlDelay,
    assumed: false,
  };
}

/**
 * Whether a path is permitted.
 *
 * Longest match wins, and allow beats disallow at equal length, which is the
 * behaviour the major crawlers converged on.
 */
export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  let best: { length: number; allow: boolean } | null = null;

  for (const rule of policy.rules) {
    if (rule.path === '') {
      // An empty Disallow means "nothing is disallowed".
      if (!rule.allow) continue;
    }
    if (!matches(rule.path, path)) continue;

    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }

  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  if (pattern === '') return false;

  const anchoredEnd = pattern.endsWith('$');
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const segments = body.split('*');

  let index = 0;
  for (let position = 0; position < segments.length; position += 1) {
    const segment = segments[position]!;
    if (segment === '') continue;

    const found = position === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, index);
    if (found === -1) return false;
    index = found + segment.length;
  }

  return anchoredEnd ? index === path.length : true;
}
