# Revenue Hunter — connections required

Everything below is intentionally configuration-only; no secrets are committed.

## 1. Cloudflare D1 — required
Create a D1 database named `revenue-hunter`, put its database ID into `wrangler.jsonc`, then apply `migrations/0001_init.sql` to the remote database. Binding name must remain `REVENUE_DB` to preserve isolation from Opportunity Radar.

## 2. Cloudflare Browser Run — required for live investigation
Enable Browser Run and keep the Worker browser binding named `BROWSER`. The Worker compatibility date is already new enough for Quick Actions. Investigation uses the `markdown` and `links` Quick Actions.

## 3. Google Places API key — required for live prospect discovery
Enable Places API (New). Add secret `GOOGLE_PLACES_API_KEY` to the Revenue Hunter Worker only. Revenue Hunter requests only the fields it needs through an explicit field mask.

## 4. Hunter API key — optional until contact enrichment
Add secret `HUNTER_API_KEY` only when you want contact enrichment. The system spends Hunter calls only after a prospect has been selected for enrichment.

## 5. Outreach — deliberately not connected yet
v0.1 does not auto-send cold email. The system prepares prospect intelligence and a demo; outreach must remain human-approved until targeting quality and compliance rules are proven.

## 6. Opportunity Radar exchange — optional
Do not share a database. If the Operating System wants Revenue Hunter outputs, consume `GET /api/exchange/export`, validate against `contracts/opportunity-exchange.schema.json`, and treat the payload as an external signal. Opportunity Radar must not write back into Revenue Hunter rankings or state.
