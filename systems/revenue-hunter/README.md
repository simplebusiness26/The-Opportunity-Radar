# Revenue Hunter v0.1

Revenue Hunter is an independent near-term revenue system. It finds real businesses, inspects public web journeys, ranks monetisable problems, creates an opportunity dossier and indicative offer, generates a private demo page, optionally enriches business contacts, and records commercial outcomes.

## Non-interference rule

Revenue Hunter and Opportunity Radar are siblings. Revenue Hunter has its own code, D1 database (`REVENUE_DB`), scoring, lifecycle and results. It never reads or writes Opportunity Radar tables. The only integration point is the versioned, read-only export contract at `GET /api/exchange/export`. A higher-level Operating System may consume both systems' outputs.

## Working flow

1. `POST /api/hunt` discovers businesses through Google Places Text Search (New).
2. `POST /api/prospects/:id/investigate` uses Cloudflare Browser Run to render the website, extract Markdown and visible links, detect conversion gaps, score the prospect and create an indicative offer.
3. `GET /demo/:id` renders a private, non-functional sales prototype for the proposed conversion flow.
4. `POST /api/prospects/:id/enrich` uses Hunter Domain Search to find public professional contact candidates for a high-scoring prospect.
5. Outreach remains human-approved. Revenue Hunter does not auto-send email in v0.1.
6. `POST /api/prospects/:id/outcome` records replies, wins, losses, quoted amount, paid amount and delivery cost.
7. `GET /api/dashboard` and `/` expose the operating view.

## API

- `GET /health`
- `GET /api/dashboard`
- `GET /api/prospects`
- `GET /api/prospects/:id`
- `POST /api/hunt` body `{ "query": "roofers in Brighton", "pageSize": 10 }`
- `POST /api/prospects/:id/investigate`
- `POST /api/prospects/:id/enrich`
- `POST /api/prospects/:id/outcome`
- `GET /demo/:id`
- `GET /api/exchange/export`

## Local validation

`npm test` has no third-party dependencies. Live Browser Run requires Wrangler remote mode because Quick Actions are remote-only for local development.

## Security / safety defaults

- No auto-outreach.
- No credential values committed.
- Prospect evidence comes from public business information.
- Demo forms do not submit data.
- External-system integration is read-only and versioned.
- D1 state is isolated from Opportunity Radar.
