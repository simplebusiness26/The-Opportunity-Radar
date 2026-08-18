# Testing

Four suites, each answering a different question, and none of them dependent on
a network, a credential or the wall clock.

## Unit — `npm test`

No database, parallel. Every score dimension and normaliser, weight
redistribution, confidence caps, decay including event mode, simhash and
trigram and cosine and URL canonicalisation and origin keys, the SSRF
classifier against a table of hostile URLs with an injected resolver, both state
machines exhaustively over legal *and* illegal transitions, budget arithmetic
and the degradation ladder, value-of-information ranking, prompt assembly
asserted as a produced string, every zod schema, and the projectors including
hallucinated-citation dropping.

`tests/unit/architecture.test.ts` greps the source for boundary violations, so
the architecture fails the build even if `dependency-cruiser` is misconfigured.
It also asserts that no transaction contains a `Promise.all`, which once
desynchronised the driver's protocol.

## Integration — `npm run test:integration`

Single-threaded, against real PGlite over the wire protocol. Repositories and
workspace scoping, concurrent claim loops asserting no double-claim, lease
reaping, idempotency, outbox ordering and debounce, the dedupe cascade over
realistic corpora, concurrent budget enforcement, auth and CSRF by invoking
route handlers directly, audit completeness, the investigation runner, the
memory loop, Ask Radar, and the full evidence-to-outcome loop.

Isolation is by `TRUNCATE … RESTART IDENTITY CASCADE` generated from the
catalogue, so a new table is covered the moment it is created. PGlite has no
usable `CREATE DATABASE`, so database-per-worker is not available.

An optional CI job runs the identical suite against real PostgreSQL when
`POSTGRES_TEST_URL` is set, so any PGlite divergence surfaces rather than
hiding.

## Eval — `npm run test:eval`

Scenario corpora scored against thresholds. This stage does not yet score model
behaviour and says so rather than reporting green over nothing; what it asserts
today is that the fixture corpora the evaluations read are present.

## End-to-end — `npm run test:e2e`

Playwright against the pinned preinstalled Chromium, desktop and mobile.
Determinism comes from three levers:

- **No sleeping.** Specs drive `POST /api/v1/system/tick` until the queue is
  empty, with a maximum-iteration assertion.
- **No network.** `RecordedFetcher` replays `fixtures/sources/**`.
- **No credentials or clock drift.** `AI_PROVIDER=fixture` keyed by prompt hash
  with a loud failure on a cache miss, and `RADAR_CLOCK=fixed:…` through the
  `Clock` port.

Never run `playwright install`: the browser is preinstalled and the pinned
version matches it.

## One database, run in sequence

The integration and end-to-end suites share the development database, and the
integration suite truncates every table between tests. Running them at the same
time will destroy the other's data mid-run and produce failures that look like
product bugs. `npm run check && npx playwright test` runs them in order; do not
run them in parallel shells.

## Determinism rules

`Date.now()` and `new Date()` are banned outside `src/adapters/clock` by the
linter *and* by a test that reads the source. Randomness is injected. Prompt
nonces are derived deterministically under fixture replay, which is safe because
the nonce is stripped from content regardless.
