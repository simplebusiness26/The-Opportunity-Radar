# Opportunity Radar

Autonomous opportunity intelligence.

Radar exists to answer one question:

> Given what is changing in the world, what we already possess, what we have previously learned,
> our present resources and our strategic goals — where should we deploy our next unit of effort
> for the highest expected return?

It is not an idea generator, a trend feed, or a validation-score gimmick. Its defensible
difference is the combination of **external intelligence** (what is changing outside),
**internal intelligence** (what this particular team already possesses), **execution memory**
(what happened last time), **resource allocation** (what deserves the next unit of effort) and
**closed-loop learning** (whether the recommendation was right).

Sometimes the correct answer is "build this". Sometimes it is "improve the product you already
have", "productise that component", "wait", or "do nothing — the evidence is insufficient".

## Status

Under active construction. `PROJECT_STATE.md` is the honest record of what works, what does not,
and what still needs owner-supplied credentials. `docs/` holds the design; `CONNECTIONS_REQUIRED.md`
holds the connection checklist.

## Running it locally

Radar runs with **no external credentials**. The default database is an embedded PostgreSQL
(PGlite) served over the real PostgreSQL wire protocol, so development, CI and production share a
single driver and a single migration set.

```bash
npm install
cp .env.example .env                 # then fill RADAR_SECRET_KEY (see the file)
./scripts/db-restart.sh              # embedded PostgreSQL on 127.0.0.1:5433
npm run db:migrate
npm run dev                          # http://localhost:3000
```

To point at a real PostgreSQL instance instead, set `DATABASE_URL` and re-run `npm run db:migrate`.
No code changes are involved.

## Verification

```bash
npm run check          # typecheck + lint + architectural boundaries + unit + integration
npm run test:e2e       # acceptance tests (uses the pinned Chromium in this image)
```

## Operating modes

| Mode | Requires | What it does |
| --- | --- | --- |
| Manual | nothing | Enter signals, evidence and capabilities by hand; deterministic scoring, clustering, dedupe, decay and allocation all work. |
| AI-assisted | an AI provider | Extraction, classification, semantic grouping, research synthesis, fit analysis, red-teaming, validation design. |
| Autonomous | provider + sources + schedules | The full loop runs on its own and asks for a human only where a human decision is genuinely wanted. |

The mode is **derived from configuration, never declared**. Machine Status shows which mode is
active and exactly which precondition is missing for the next one.
