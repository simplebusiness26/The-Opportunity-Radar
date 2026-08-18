# Project state

An honest record of what works, what does not, and what needs somebody's
credentials. Written to be checked rather than believed: every claim below
corresponds to a test that runs in CI.

Last updated at the end of the build described in `docs/`.

## Test status

| Suite | Count | What it covers |
| --- | --- | --- |
| Unit | 412 | Scoring, dedupe, decay, clustering, leverage, fit, allocation, budget, both state machines, SSRF, prompt safety, projectors, calibration, triggers, the execution brief |
| Integration | 136 | Repositories and workspace scoping, queue concurrency and leases, outbox ordering and debounce, auth and CSRF, budget under concurrency, investigation, memory, Ask Radar, the full loop |
| Eval | 12 | Ten scenario corpora against the injection defence, the projection rules, and the scorers themselves |
| End-to-end | 50 | Five acceptance tests, the manual loop, auth and headers, mobile layout — all with no AI provider |

`npm run check` runs typecheck, lint, dependency rules, unit, and integration.
`npx playwright test` runs the rest.

## Completed

**Rails and security.** Hexagonal architecture enforced twice (dependency-cruiser
and a source-grepping test). Tenancy on every table and every repository
function. Email and password auth with scrypt, DB-backed sessions, CSRF,
security headers, rate limiting, encrypted secrets, audit log.

**Manual mode.** The entire loop runs by hand with nothing connected: record
evidence, three-level dedupe with reason codes, clusters, opportunities and
their lifecycle, twenty-one scoring dimensions with confidence computed
separately, decay, allocation, the daily brief, the decision log.

**Autonomy substrate.** Job queue with `SKIP LOCKED`, leases and a reaper,
scheduler with per-bucket dedupe keys, transactional outbox with debounced
routing, the tick endpoint, alerts, Machine view.

**Internal intelligence.** Capability taxonomy and graph, assets, resources,
goals, build leverage as a range, fit, allocation with named rationale.

**AI layer.** Provider-independent gateway, two-phase atomic budget reservation,
the degradation ladder, prompt assembly with per-call nonce, structured output
with a single repair, projectors that drop invented citations.

**Ingestion.** `SafeFetcher` with DNS pinning, five source adapters behind one
manifest, robots and rate limits respected and recorded.

**Investigation.** Six roles under a deterministic depth gate, the red team with
its verdict held to a citation standard, uncertainty and value-of-information,
validation plans and experiments judged against thresholds fixed beforehand.

**Memory.** Re-evaluation triggers, opportunity relationships, execution history,
calibration that refuses below eight samples.

**Ask Radar.** Grounded retrieval over the workspace's own records, mandatory
citations, refusal when it cannot answer, search-only fallback with no provider.

**Execution boundary.** The Execution Brief with its readiness verdict, handoff
with a snapshotted brief, optional delivery, and a feedback endpoint that closes
the loop into calibration.

## Not built, deliberately

Listed with reasons in `ROADMAP.md`. In short: ANN vector indexing, a semantic
embedder by default, SSO, notification *delivery*, the GitHub App install flow,
real-time collaboration, fine-tuning, ToS-violating scraping, Monte Carlo
simulation, forecasting beyond trailing means, load-tested scale-out, a native
app.

## Known limitations

**The default embedder is lexical.** Hashed character n-grams catch spelling and
phrasing variation, not synonymy. Two posts describing the same problem in
entirely different words count as two pieces of evidence unless they share
entities or a URL. Labelled `lexical-v1` everywhere it appears.

**Cosine similarity is computed in TypeScript** over a blocked candidate set.
This scales to a workspace, not to a corpus. PGlite does not bundle `vector`.

**The evaluation suite does not yet score a live model.** The ten corpora, the
six scorers and the harness exist and run; the model-dependent half is reported
as *not scored* rather than passing, and there is a test asserting exactly that
so the green stage cannot be misread.

**Source health is observable but not weighted.** Fetch outcomes and injection
attempts are recorded per source; letting a persistently unreliable source count
for less is on the roadmap.

**Multi-worker throughput is untested at scale.** The queue is designed for it
and multiple workers are safe by construction, but no load test has been run, so
no throughput figure is claimed.

**Momentum is a trailing measure.** Anything more would be extrapolation
presented as measurement.

## Blockers

None. Radar runs, and every acceptance test passes, with no credentials at all.

## Owner connections required

All optional; each adds capability. Full detail, including exactly where to get
each credential and how to test it, is in `CONNECTIONS_REQUIRED.md`.

| Connection | Adds | Without it |
| --- | --- | --- |
| An AI provider | Investigation, red team, Ask Radar in prose | Manual mode, which is complete |
| A source | Autonomous collection | Record evidence by hand |
| A delivery target | Handoffs posted to your build system | Export the brief and send it yourself |
| `RADAR_FEEDBACK_TOKEN` | Outcomes reported back automatically | Record outcomes in the interface |
| `RADAR_TICK_TOKEN` | Serverless scheduling | Run `npm run worker` |

## Next autonomous action

If nothing is connected, Radar's next useful act is to tell you what it cannot
do — which is what `/onboarding` does, derived from the data rather than from a
stored flag.

If a provider and a source are connected, the machine will, unattended: poll
sources, deduplicate, cluster, score, sweep for opportunities that have earned
investigation, run the roles that the depth policy allows, evaluate
re-evaluation triggers, raise alerts and write the daily brief. It will not
reject an opportunity, commit resources, spend past the budget, or hand work
over — those are decisions, and decisions belong to the owner.
