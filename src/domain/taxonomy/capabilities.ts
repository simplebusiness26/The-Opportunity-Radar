/**
 * The shared vocabulary for what a team can do.
 *
 * This is the quiet load-bearing piece of the whole leverage idea. "This
 * opportunity needs payments" and "we have built payments" must resolve to the
 * same key, or matching them degenerates into asking a model whether two
 * strings mean the same thing -- which is unpredictable, unauditable and
 * impossible to test. Both sides resolve to a key here, and anything that will
 * not resolve is reported as a gap rather than quietly guessed at.
 */

export interface CapabilityDefinition {
  key: string;
  label: string;
  parent: string | null;
  /** Words that map to this capability, all lower case. */
  aliases: string[];
  /** Rough greenfield build cost in days, for a competent team. */
  typicalBuildDays: number;
}

const define = (
  key: string,
  label: string,
  parent: string | null,
  typicalBuildDays: number,
  aliases: string[] = [],
): CapabilityDefinition => ({ key, label, parent, typicalBuildDays, aliases });

export const CAPABILITY_TAXONOMY: CapabilityDefinition[] = [
  define('platform', 'Platform', null, 0),
  define('platform.auth', 'Authentication and accounts', 'platform', 6, [
    'auth',
    'authentication',
    'login',
    'sign in',
    'sso',
    'user accounts',
  ]),
  define('platform.multi_tenant', 'Multi-tenant workspaces', 'platform', 8, [
    'multi tenant',
    'multitenancy',
    'organisations',
    'workspaces',
    'teams',
  ]),
  define('platform.permissions', 'Roles and permissions', 'platform', 4, [
    'rbac',
    'permissions',
    'roles',
    'access control',
  ]),
  define('platform.audit', 'Audit logging', 'platform', 3, ['audit', 'audit log', 'activity log']),
  define('platform.jobs', 'Background jobs and scheduling', 'platform', 6, [
    'background jobs',
    'queue',
    'worker',
    'cron',
    'scheduler',
  ]),
  define('platform.notifications', 'Notifications', 'platform', 5, [
    'notifications',
    'email sending',
    'push notifications',
    'alerts',
  ]),
  define('platform.file_storage', 'File storage and uploads', 'platform', 4, [
    'uploads',
    'file storage',
    's3',
    'object storage',
  ]),
  define('platform.search', 'Search', 'platform', 6, ['search', 'full text search', 'elasticsearch']),

  define('commerce', 'Commerce', null, 0),
  define('commerce.payments', 'Taking payments', 'commerce', 8, [
    'payments',
    'stripe',
    'checkout',
    'card payments',
    'deposits',
  ]),
  define('commerce.subscriptions', 'Subscription billing', 'commerce', 10, [
    'billing',
    'subscriptions',
    'recurring billing',
    'invoicing',
  ]),
  define('commerce.marketplace', 'Marketplace and payouts', 'commerce', 18, [
    'marketplace',
    'payouts',
    'split payments',
    'two sided',
  ]),

  define('data', 'Data', null, 0),
  define('data.pipelines', 'Data pipelines', 'data', 10, [
    'etl',
    'data pipeline',
    'ingestion',
    'scraping',
  ]),
  define('data.analytics', 'Analytics and reporting', 'data', 8, [
    'analytics',
    'dashboards',
    'reporting',
    'charts',
  ]),
  define('data.warehouse', 'Data warehousing', 'data', 12, ['warehouse', 'bigquery', 'snowflake']),

  define('ai', 'AI', null, 0),
  define('ai.llm_workflows', 'LLM workflows', 'ai', 8, [
    'llm',
    'prompting',
    'ai workflows',
    'agents',
    'openai',
    'anthropic',
  ]),
  define('ai.extraction', 'Structured extraction', 'ai', 6, [
    'extraction',
    'structured output',
    'parsing documents',
  ]),
  define('ai.embeddings', 'Embeddings and semantic search', 'ai', 7, [
    'embeddings',
    'vector search',
    'semantic search',
    'rag',
  ]),
  define('ai.evaluation', 'AI evaluation', 'ai', 6, ['evals', 'ai testing', 'model evaluation']),

  define('interface', 'Interface', null, 0),
  define('interface.web_app', 'Responsive web application', 'interface', 10, [
    'web app',
    'spa',
    'frontend',
    'react',
  ]),
  define('interface.mobile', 'Mobile application', 'interface', 20, [
    'mobile app',
    'ios',
    'android',
    'react native',
  ]),
  define('interface.pwa', 'Installable web app', 'interface', 4, ['pwa', 'offline', 'installable']),
  define('interface.maps', 'Maps and geospatial', 'interface', 9, [
    'maps',
    'mapping',
    'geospatial',
    'maplibre',
    'mapbox',
    'leaflet',
  ]),
  define('interface.realtime', 'Realtime and collaboration', 'interface', 12, [
    'realtime',
    'websockets',
    'live updates',
    'collaboration',
  ]),

  define('integration', 'Integration', null, 0),
  define('integration.public_api', 'Public API', 'integration', 8, ['public api', 'rest api', 'api']),
  define('integration.webhooks', 'Webhooks', 'integration', 4, ['webhooks', 'callbacks']),
  define('integration.calendar', 'Calendar integration', 'integration', 7, [
    'calendar',
    'google calendar',
    'ical',
    'scheduling integration',
  ]),
  define('integration.crm', 'CRM integration', 'integration', 8, ['crm', 'salesforce', 'hubspot']),
  define('integration.accounting', 'Accounting integration', 'integration', 9, [
    'accounting',
    'xero',
    'quickbooks',
  ]),

  define('operations', 'Operations', null, 0),
  define('operations.deployment', 'Deployment and hosting', 'operations', 4, [
    'deployment',
    'hosting',
    'ci',
    'cd',
    'devops',
  ]),
  define('operations.monitoring', 'Monitoring and observability', 'operations', 5, [
    'monitoring',
    'observability',
    'logging',
    'metrics',
  ]),
  define('operations.compliance', 'Compliance and certification', 'operations', 25, [
    'compliance',
    'gdpr',
    'soc2',
    'iso 27001',
    'regulatory approval',
  ]),

  define('gtm', 'Go to market', null, 0),
  define('gtm.distribution', 'Distribution channel', 'gtm', 20, [
    'distribution',
    'audience',
    'newsletter',
    'community',
    'existing users',
  ]),
  define('gtm.content', 'Content and SEO', 'gtm', 12, ['content', 'seo', 'blog', 'marketing site']),
  define('gtm.sales', 'Direct sales', 'gtm', 15, ['sales', 'outbound', 'cold outreach']),
  define('gtm.support', 'Customer support', 'gtm', 6, ['support', 'helpdesk', 'customer service']),

  define('domain_knowledge', 'Domain knowledge', null, 0),
  define('domain_knowledge.regulated', 'Regulated industry knowledge', 'domain_knowledge', 30, [
    'regulated',
    'healthcare knowledge',
    'financial services knowledge',
    'legal knowledge',
  ]),
  define('domain_knowledge.industry', 'Industry familiarity', 'domain_knowledge', 20, [
    'industry knowledge',
    'domain expertise',
    'sector experience',
  ]),
];

export const CAPABILITIES_BY_KEY = new Map(
  CAPABILITY_TAXONOMY.map((capability) => [capability.key, capability]),
);

export type CapabilityKey = string;

const ALIAS_INDEX = (() => {
  const index = new Map<string, string>();
  for (const capability of CAPABILITY_TAXONOMY) {
    index.set(normalise(capability.key), capability.key);
    index.set(normalise(capability.label), capability.key);
    for (const alias of capability.aliases) index.set(normalise(alias), capability.key);
  }
  return index;
})();

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface CapabilityResolution {
  key: string | null;
  /** How the match was made, so the interface never overstates its certainty. */
  method: 'exact' | 'alias' | 'partial' | 'unresolved';
  input: string;
}

/**
 * Maps free text onto a taxonomy key.
 *
 * Returns `unresolved` rather than a best guess when nothing matches. An
 * unresolved requirement is reported to the owner as a gap in the vocabulary,
 * which is honest and fixable; a wrong guess would quietly corrupt every
 * leverage estimate that depended on it.
 */
export function resolveCapability(input: string): CapabilityResolution {
  const normalised = normalise(input);
  if (!normalised) return { key: null, method: 'unresolved', input };

  const exact = ALIAS_INDEX.get(normalised);
  if (exact) {
    return { key: exact, method: CAPABILITIES_BY_KEY.has(input) ? 'exact' : 'alias', input };
  }

  // A containment match, longest alias first so "subscription billing" beats
  // "billing". Only accepted for aliases long enough to be meaningful.
  let best: { key: string; length: number } | null = null;
  for (const [alias, key] of ALIAS_INDEX) {
    if (alias.length < 4) continue;
    if (normalised.includes(alias) || alias.includes(normalised)) {
      if (!best || alias.length > best.length) best = { key, length: alias.length };
    }
  }

  return best ? { key: best.key, method: 'partial', input } : { key: null, method: 'unresolved', input };
}

/** Ancestors of a capability, nearest first. Used for partial-credit matching. */
export function capabilityAncestors(key: string): string[] {
  const chain: string[] = [];
  let current = CAPABILITIES_BY_KEY.get(key)?.parent ?? null;
  while (current) {
    chain.push(current);
    current = CAPABILITIES_BY_KEY.get(current)?.parent ?? null;
  }
  return chain;
}

export function typicalBuildDays(key: string): number {
  return CAPABILITIES_BY_KEY.get(key)?.typicalBuildDays ?? 8;
}

export function capabilityLabel(key: string): string {
  return CAPABILITIES_BY_KEY.get(key)?.label ?? key;
}
