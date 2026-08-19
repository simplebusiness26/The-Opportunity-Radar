# Revenue Hunter — connections required

Everything below is intentionally configuration-only; no secrets are committed.

## 1. Cloudflare D1 — required
Create a D1 database named `revenue-hunter`, put its database ID into `wrangler.jsonc`, then apply `migrations/0001_init.sql` to the remote database. Binding name must remain `REVENUE_DB` to preserve isolation from Opportunity Radar.

## 2. Cloudflare Browser Run — required for live investigation
Enable Browser Run and keep the Worker browser binding named `BROWSER`. Investigation uses the `markdown` and `links` Quick Actions.

## 3. Google Places API key — required for live prospect discovery
Enable Places API (New). Add secret `GOOGLE_PLACES_API_KEY` to the Revenue Hunter Worker only. Revenue Hunter requests only the fields it needs through an explicit field mask.

## 4. Hunter API key — optional until contact enrichment
Add secret `HUNTER_API_KEY` only when you want contact enrichment. The system spends Hunter calls only after a prospect has been selected for enrichment.

## 5. Stripe secret key — optional until a customer agrees to buy
Add secret `STRIPE_SECRET_KEY` only when you want Revenue Hunter to create one-off Payment Links. The payment-link endpoint uses the prospect's stored offer price by default and can accept an explicit final amount.

## 6. Scheduled hunt target — required only for autonomous daily runs
Set non-secret variable `DEFAULT_HUNT_QUERY`, for example a target category + geography. Optional `DEFAULT_HUNT_SIZE` defaults to 10. The configured Cron Trigger runs daily at 06:00 UTC, but exits without doing anything if `DEFAULT_HUNT_QUERY` is absent.

## 7. Outreach — deliberately not auto-connected
Revenue Hunter generates a personalised outreach draft but does not send it. This keeps the first live version human-approved while targeting quality and compliance are proven.

## 8. Opportunity Radar exchange — optional
Do not share a database. If the Operating System wants Revenue Hunter outputs, consume `GET /api/exchange/export`, validate against `contracts/opportunity-exchange.schema.json`, and treat the payload as an external signal. Opportunity Radar must not write back into Revenue Hunter rankings or state.
