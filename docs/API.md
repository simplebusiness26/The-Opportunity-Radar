# API

Everything the interface does, it does through this API. There is no private
back channel, which is why the acceptance tests can drive the product through it
and still be testing the real thing.

## Conventions

- Base path `/api/v1`.
- Success: `{"data": …}`. Failure: `{"error": {"kind", "code", "message",
  "remedy"}}`. Every error carries a `remedy` — what the caller can do about it.
- Session cookie authentication, plus `x-radar-csrf` on every state-changing
  request. Cross-origin state-changing requests are refused outright.
- Two endpoints use bearer tokens instead, because their callers are machines:
  `/system/tick` and `/execution/feedback`. Both are disabled outright when no
  token is configured.
- Every request is scoped to the caller's workspace. There is no endpoint that
  takes a workspace id from the caller.

## Evidence and opportunities

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/signals` | Record an observation; returns the dedupe outcome and why |
| `GET` | `/signals` | List and filter signals |
| `POST` | `/opportunities` | Create an opportunity |
| `GET` | `/opportunities/{id}` | Opportunity, current score, history, transitions, evidence |
| `POST` | `/opportunities/{id}/evidence` | Attach evidence with a stance |
| `POST` | `/opportunities/{id}/score` | Recompute; returns what moved |
| `POST` | `/opportunities/{id}/transition` | Move through the lifecycle, with a reason |
| `PUT` | `/opportunities/{id}/requirements` | Set capability requirements; resolved against the taxonomy |
| `GET` | `/opportunities/{id}/requirements` | Requirements with leverage and fit |

## Investigation and validation

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/opportunities/{id}/investigation` | The log: runs, findings, corrections, spend, unknowns, plan |
| `POST` | `/opportunities/{id}/investigation` | Queue an investigation (needs a provider) |
| `GET`/`POST` | `/opportunities/{id}/validation-plan` | Read or write a plan by hand |
| `POST` | `/experiments` | Create an experiment from a plan |
| `POST` | `/experiments/{id}` | Move it through its lifecycle |
| `POST` | `/experiments/{id}/results` | Record a measurement |
| `POST` | `/experiments/{id}/conclude` | Judge it against the agreed thresholds |

## Memory

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/opportunities/{id}/triggers` | Armed triggers and proposals; arm one |
| `GET`/`POST`/`DELETE` | `/opportunities/{id}/relationships` | Links and suggestions |
| `GET`/`POST` | `/execution-history` | Outcomes and the calibration computed from them |

## Execution boundary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/opportunities/{id}/brief` | The brief as JSON, or `?format=markdown` |
| `POST` | `/opportunities/{id}/handoff` | Commit it to be built (owner only) |
| `GET`/`POST` | `/settings/factory` | Where handoffs are delivered |
| `POST` | `/execution/feedback` | **Bearer token.** Report what happened |

## Machine

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/system/tick` | **Bearer token.** One scheduler pass plus a drain |
| `POST` | `/system/run` | Run one scheduled job now |
| `POST` | `/ask` | Ask Radar. `POST` so questions stay out of logs and history |

## Errors worth knowing

| Code | Means |
| --- | --- |
| `opportunity.illegal_transition` | The lifecycle refuses it; the remedy lists what is allowed |
| `handoff.not_ready` | The brief says it is not ready; confirm explicitly to overrule |
| `trigger.no_conditions` | A trigger that would match everything |
| `plan.thresholds_overlap` | Success and failure would both be true |
| `experiment.not_accepting_results` | It has not run, or it has concluded |
| `csrf.token_rejected` / `csrf.origin_rejected` | Missing token, or cross-origin |
