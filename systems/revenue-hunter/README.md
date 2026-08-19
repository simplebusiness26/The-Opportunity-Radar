# Revenue Hunter v0.1.1

Revenue Hunter is an independent near-term revenue system. It finds real businesses, inspects public web journeys, ranks monetisable problems, creates an opportunity dossier and indicative offer, generates a private demo page, optionally enriches professional contacts, drafts human-approved outreach, can create a Stripe payment link after a sale, and records commercial outcomes.

## Non-interference rule

Revenue Hunter and Opportunity Radar are siblings. Revenue Hunter has its own code, D1 database (`REVENUE_DB`), scoring, lifecycle and results. It never reads or writes Opportunity Radar tables. The only integration point is the versioned, read-only export contract at `GET /api/exchange/export`. A higher-level Operating System may consume both systems' outputs.

## Working flow

1. `POST /api/run` discovers businesses through Google Places and immediately investigates/ranks each business with a website.
2. Investigation uses Cloudflare Browser Run to render the public website, extract Markdown and visible links, detect conversion gaps, score the prospect and create an indicative offer.
3. `GET /demo/:id` renders a private, non-functional sales prototype for the proposed conversion flow.
4. `POST /api/prospects/:id/enrich` optionally uses Hunter Domain Search to find public professional contact candidates for a chosen prospect.
5. `GET /api/prospects/:id/outreach-draft` prepares a personalised draft but never sends it. Human approval remains mandatory.
6. `POST /api/prospects/:id/payment-link` can create a one-off Stripe Payment Link once a customer agrees to buy.
7. `POST /api/prospects/:id/outcome` records replies, wins, losses, quoted amount, paid amount and delivery cost.
8. A Cloudflare Cron Trigger can run a default hunt automatically once per day when `DEFAULT_HUNT_QUERY` is configured.
9. `GET /api/dashboard` and `/` expose the operating view.

## API

- `GET /health`
- `GET /api/dashboard`
- `GET /api/prospects`
- `GET /api/prospects/:id`
- `POST /api/run` body `{ "query": "roofers in Brighton", "pageSize": 10 }`
- `POST /api/hunt` discovery-only endpoint
- `POST /api/prospects/:id/investigate`
- `POST /api/prospects/:id/enrich`
- `GET /api/prospects/:id/outreach-draft`
- `POST /api/prospects/:id/payment-link`
- `POST /api/prospects/:id/outcome`
- `GET /demo/:id`
- `GET /api/exchange/export`

## Scheduled mode

The Worker has a daily `0 6 * * *` Cron Trigger. Scheduled execution does nothing until `DEFAULT_HUNT_QUERY` is configured, so deployment cannot accidentally begin prospecting a category chosen by the codebase. `DEFAULT_HUNT_SIZE` is optional and defaults to 10.

## Local validation

`npm test` has no third-party dependencies. Live Browser Run requires Wrangler remote mode because Quick Actions are remote-only for local development.

## Security / safety defaults

- No auto-outreach.
- No credential values committed.
- Prospect evidence comes from public business information.
- Demo forms do not submit data.
- Payment links are created only through an explicit endpoint after a price exists.
- External-system integration is read-only and versioned.
- D1 state is isolated from Opportunity Radar.
