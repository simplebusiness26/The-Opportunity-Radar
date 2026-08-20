import fs from 'node:fs/promises';

const cfg = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const checks = [
  { name: 'D1 database id', ok: !cfg.includes('REPLACE_WITH_D1_DATABASE_ID'), tier: 'required-free' },
  { name: 'Browser Run binding', ok: cfg.includes('"binding": "BROWSER"'), tier: 'required-free' },
  { name: 'OpenStreetMap discovery fallback', ok: true, tier: 'required-free' },
  { name: 'Companies House enrichment key', ok: Boolean(process.env.COMPANIES_HOUSE_API_KEY), tier: 'optional-free' },
  { name: 'Google Places key', ok: Boolean(process.env.GOOGLE_PLACES_API_KEY), tier: 'held-paid' },
  { name: 'Hunter key', ok: Boolean(process.env.HUNTER_API_KEY), tier: 'held-paid' },
  { name: 'Stripe key', ok: Boolean(process.env.STRIPE_SECRET_KEY), tier: 'held-paid' },
  { name: 'Default scheduled hunt query', ok: Boolean(process.env.DEFAULT_HUNT_QUERY), tier: 'optional-free' }
];

const blockers = checks.filter(c => c.tier === 'required-free' && !c.ok);
console.log('Revenue Hunter v0.4 free-first configuration doctor\n');
for (const c of checks) {
  const state = c.ok ? 'PASS' : c.tier === 'required-free' ? 'BLOCK' : c.tier === 'optional-free' ? 'FREE OPTIONAL' : 'HELD BACK';
  console.log(`${state.padEnd(13)} ${c.name}`);
}
console.log(`\n${blockers.length ? `${blockers.length} free live-run blocker(s) remain.` : 'Core free live-run configuration is ready.'}`);
console.log('Companies House adds free UK verification when a free API key is connected.');
console.log('Paid integrations are deliberately not required.');
process.exitCode = blockers.length ? 2 : 0;
