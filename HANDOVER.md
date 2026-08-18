# Opportunity Radar — handover

## Product status

Built and running. Every phase in the plan is complete, and the five acceptance
tests pass in CI **with no AI provider, no source credential and no network** —
which is the specific claim this product makes about where its judgement lives.

Radar answers one question: given what is changing outside, what this team
already has, what it has previously learned, its present resources and its
goals, where should the next unit of effort go? It is willing to answer "nowhere
yet", and does.

## Exact test results

```
Unit          412 passed   (22 files)
Integration   136 passed   (13 files, real PostgreSQL wire protocol)
Eval           12 passed   (10 scenario corpora)
End-to-end     50 passed   (desktop + mobile, 5 acceptance tests)
```

`npm run check` runs typecheck, lint, dependency rules, unit and integration.
`npx playwright test` runs the rest. Both are green. The suites share one
development database and must be run in sequence, not in parallel.

### The five acceptance tests

| | What it proves |
| --- | --- |
| **(a) The full loop** | Evidence → opportunity → hand-written validation plan → experiment → verdict against thresholds fixed beforehand → score moves → owner decides → Execution Brief → handoff → outcome reported back → calibration. All without a provider. |
| **(b) Kill an attractive idea** | Loud complaint with no observed spending leaves willingness-to-pay as *insufficient evidence*, not zero; confidence is capped; the gap is named on screen; the lifecycle does not offer a route that skips validation. |
| **(c) Personal advantage** | Two opportunities with near-identical external evidence rank differently because one reuses `billing-service`, and the explanation names the asset. |
| **(d) Null result** | Several observations from one origin produce `NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION`, rendered exactly, with the cheapest next actions. |
| **(e) Reopen a rejection** | A rejected opportunity reopens when its trigger is satisfied, and the transition names the exact signal that caused it. |

## Architecture in one paragraph

Hexagonal TypeScript. `src/domain` is pure — scoring, dedupe, decay, clustering,
leverage, fit, allocation, budget arithmetic, both state machines, SSRF rules,
calibration — with no IO, no framework and no clock. `src/ports` declares
interfaces; `src/adapters` implements them; `src/application` holds use-cases
over ports; `src/pipeline` holds the AI gateway, prompt assembly, projection and
the investigation runner; `src/jobs` the queue and event router; `src/web` and
`app/` the delivery layer. `src/composition` is the only place that reads
configuration. Boundaries are enforced by `dependency-cruiser` **and** by a test
that greps the source, because a misconfigured linter is a silent failure.

One PostgreSQL schema, one Drizzle migration set, one driver everywhere:
development and CI run PGlite behind the real wire protocol, production points
`DATABASE_URL` at a server, and no code branches on which is in use.

## How to run it

```bash
npm install
cp .env.example .env           # fill RADAR_SECRET_KEY; the file explains how
./scripts/db-restart.sh        # embedded PostgreSQL on 127.0.0.1:5433
npm run db:migrate
npm run db:seed                # optional; everything it writes is badged DEMO
npm run dev                    # http://localhost:3000
npm run worker                 # the machine, in a second terminal
```

## How to deploy it

Two shapes, both first-class, both calling the same `tick()`:

- **Long-running process** — `npm run build && npm run start` plus
  `npm run worker`. The worker holds its own scheduler.
- **Serverless** — deploy the app, set `RADAR_TICK_TOKEN`, and have any
  scheduler `POST /api/v1/system/tick` every few minutes. `npm run tick` does
  the same from cron.

Point `DATABASE_URL` at PostgreSQL 14+, run `npm run db:migrate`, put it behind
TLS, and back up `RADAR_SECRET_KEY` — without it every stored credential must be
re-entered. Full detail in `docs/DEPLOYMENT.md`.

## Owner connections required

None to run. Everything below is optional and adds capability; each is fully
implemented, configurable, degrades gracefully and says what is missing.
`CONNECTIONS_REQUIRED.md` gives the exact credential, where to get it, where to
enter it, how to test it and what it costs.

| Connection | Adds | Without it |
| --- | --- | --- |
| An AI provider | Investigation, red team, Ask Radar in prose | Manual mode, which is complete |
| A source (HN and RSS need no credential) | Autonomous collection | Record evidence by hand |
| A handoff delivery URL | Briefs posted to your build system | Export the brief yourself |
| `RADAR_FEEDBACK_TOKEN` | Outcomes reported back automatically | Record outcomes in the interface |
| `RADAR_TICK_TOKEN` | Serverless scheduling | Run the worker |

## Current limitations

Stated fully in `PROJECT_STATE.md` and `docs/FAILURE_MODES.md`. The ones that
matter most:

- **The default embedder is lexical**, so it catches spelling variation, not
  synonymy. Two posts describing the same problem in entirely different words
  count as two pieces of evidence. Labelled `lexical-v1` wherever it appears.
- **Cosine runs in TypeScript** over a blocked candidate set: workspace scale,
  not corpus scale. PGlite does not bundle `vector`.
- **The evaluation suite does not yet score a live model.** The corpora, scorers
  and harness exist and run; the model-dependent half is reported as *not
  scored*, with a test asserting exactly that.
- **Alert delivery is not built** — alerts are raised and shown, never emailed.
  No credential exists to deliver with, and a notifier that silently drops
  alerts is worse than none.
- **No throughput figure is claimed.** The queue is designed to scale out and is
  safe under concurrency by construction, but it has not been load-tested.

## Cost model

Radar costs nothing to run without a provider. With one:

- Model prices are **workspace-configured**. Radar ships no guesses about what a
  provider charges, and every derived figure is labelled *estimated* because it
  comes from those prices rather than from a bill.
- A full six-role investigation is capped at about **$3.50** by the per-role
  ceilings. Most candidates never reach a paid role: the depth gate requires
  three unique pieces of evidence, two independent sources and a preliminary
  score of 45 before anything is spent, and 55 before the expensive red team.
- The budget is enforced by a single-statement atomic reservation, not a
  read-then-write, and it fails closed. The degradation ladder warns at 70%,
  degrades at 85%, restricts to high-value decisions at 95% and stops at 100% —
  where dependent work goes to *blocked*, not *failed*, and resumes at rollover.
- **Manual mode remains fully functional at a hard stop.**

## Autonomy status

With a provider, a source and a schedule connected, Radar will unattended: poll
sources, deduplicate, cluster, score, sweep for opportunities that have earned
investigation, run the roles the depth policy allows, evaluate re-evaluation
triggers, raise alerts and write the daily brief.

It will not reject an opportunity, commit resources, spend past the budget, or
hand work over. Those are decisions, and the system actor deliberately holds no
permission to take them — which is also why a compromised source cannot escalate
through a background job.

## The five best next improvements

1. **An embedding provider adapter** behind the existing `AIProvider.embed`
   port. The single largest improvement available to dedupe and clustering
   quality, and the plumbing already exists.
2. **Wire the live evaluation path.** The ten corpora and six scorers are built;
   connecting them to a real provider turns "we believe the roles behave" into a
   number that fails the build when it regresses.
3. **Feed source health into confidence.** Fetch outcomes and injection attempts
   are already recorded per source; letting a persistently unreliable source
   count for less closes a loop that is currently only observable.
4. **Alert delivery**, once any credential exists to deliver with. Everything
   upstream — raising, deduplicating, suppressing — is done.
5. **pgvector and an ANN index** behind the same repository interface, for the
   day a workspace outgrows in-process cosine.

## Where to read next

`docs/INDEX.md` lists everything in `docs/`. If you read three:
`docs/PRODUCT.md` for what this is for, `docs/DECISIONS.md` for why it is built
this way, and `docs/FAILURE_MODES.md` for how it could still be wrong.
