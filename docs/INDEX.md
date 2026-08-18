# Documentation

Start with `PRODUCT.md` if you want to know what Radar is for, `ARCHITECTURE.md`
if you want to know how it is built, and `PROJECT_STATE.md` (in the repository
root) if you want to know what actually works.

## What it is

- **[PRODUCT.md](PRODUCT.md)** — the question Radar answers, what it refuses to
  be, and what honesty means here concretely.
- **[MODES.md](MODES.md)** — manual, AI-assisted, autonomous, and why the mode
  is derived rather than declared.
- **[GLOSSARY.md](GLOSSARY.md)** — every term, and what each is careful not to
  mean.
- **[ONBOARDING.md](ONBOARDING.md)** — getting to a state where the answers are
  worth reading.

## How it decides

- **[EVIDENCE.md](EVIDENCE.md)** — classes, signal types, decay,
  counter-evidence, independence.
- **[DEDUPLICATION.md](DEDUPLICATION.md)** — the three levels and the cascade.
- **[SCORING.md](SCORING.md)** — dimensions, composites, and why confidence is
  never a weight.
- **[ALLOCATION.md](ALLOCATION.md)** — expected value, the policy floors, and
  the null result.
- **[INVESTIGATION.md](INVESTIGATION.md)** — the six roles, the depth gate, and
  the red team.
- **[MEMORY.md](MEMORY.md)** — re-evaluation triggers, relationships,
  calibration.
- **[ASK_RADAR.md](ASK_RADAR.md)** — grounded retrieval and mandatory citations.
- **[EXECUTION_BOUNDARY.md](EXECUTION_BOUNDARY.md)** — the brief, the handoff,
  and closing the loop.
- **[BRIEF.md](BRIEF.md)** — the daily brief, and why no model writes it.

## How it is built

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — layers, boundaries, and the database.
- **[DATA_MODEL.md](DATA_MODEL.md)** — the tables and the JSON-versus-columns
  rule.
- **[JOBS.md](JOBS.md)** — the queue, the outbox, and the two ways to run it.
- **[AI_PIPELINE.md](AI_PIPELINE.md)** — the gateway, structured output,
  projection.
- **[INGESTION.md](INGESTION.md)** — the pipeline and the source adapters.
- **[COST_CONTROL.md](COST_CONTROL.md)** — reservation, the degradation ladder,
  the ledger.
- **[API.md](API.md)** — every endpoint the interface uses.
- **[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)** — the interface principles.
- **[DECISIONS.md](DECISIONS.md)** — the choices that shaped it, and their cost.

## Running and trusting it

- **[DEPLOYMENT.md](DEPLOYMENT.md)** — both deployment shapes.
- **[OPERATIONS.md](OPERATIONS.md)** — the Machine view, run-now, backups.
- **[SECURITY.md](SECURITY.md)** — injection, SSRF, tenancy, secrets.
- **[PRIVACY.md](PRIVACY.md)** — what is stored, what is not, what leaves.
- **[ROLES.md](ROLES.md)** — permissions, and why the system actor is not a
  superuser.
- **[TESTING.md](TESTING.md)** — the four suites and the determinism rules.
- **[PERFORMANCE.md](PERFORMANCE.md)** — the shape of the work, and what is not
  claimed.
- **[FAILURE_MODES.md](FAILURE_MODES.md)** — how this could still be wrong.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — the rules that are enforced rather
  than suggested.

## In the repository root

- **PROJECT_STATE.md** — what works, what does not, what is needed.
- **CONNECTIONS_REQUIRED.md** — every optional credential, and what each adds.
- **ROADMAP.md** — what was deliberately not built, and why.
