import fs from 'node:fs/promises';

const cfg = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const checks = [
  { name: 'D1 database id', ok: !cfg.includes('REPLACE_WITH_D1_DATABASE_ID'), required: true },
  { name: 'Browser Run binding', ok: cfg.includes('"binding": "BROWSER"'), required: true },
  { name: 'Google Places key', ok: Boolean(process.env.GOOGLE_PLACES_API_KEY), required: true },
  { name: 'Hunter key', ok: Boolean(process.env.HUNTER_API_KEY), required: false },
  { name: 'Stripe key', ok: Boolean(process.env.STRIPE_SECRET_KEY), required: false },
  { name: 'Default hunt query', ok: Boolean(process.env.DEFAULT_HUNT_QUERY), required: false }
];

const blockers = checks.filter(c => c.required && !c.ok);
console.log('Revenue Hunter configuration doctor\n');
for (const c of checks) console.log(`${c.ok ? 'PASS' : c.required ? 'BLOCK' : 'OPTIONAL'}  ${c.name}`);
console.log(`\n${blockers.length ? `${blockers.length} live-run blocker(s) remain.` : 'Live-run configuration appears ready.'}`);
console.log('Offline dry-run is available regardless of these results.');
process.exitCode = blockers.length ? 2 : 0;
