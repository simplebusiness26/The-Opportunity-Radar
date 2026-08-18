# Cost control

An AI budget with no enforcement is a spending limit in the same sense that a
speed limit painted on a wall is one. Radar's is enforced in the arithmetic, and
the failure mode is chosen deliberately: fail closed.

## Two-phase reservation

Every call goes through one door — `callAi` in `src/pipeline/ai-gateway.ts` —
and nothing calls a provider directly.

1. **Estimate** the maximum cost from the prompt size and the route's output
   ceiling, doubled to cover a possible repair. A call that repairs must not be
   able to overshoot the limit its first attempt fitted inside.
2. **Reserve** with a single conditional statement:
   `UPDATE budget_ledger … WHERE spent + reserved + amount <= limit RETURNING *`.
   Zero rows means denied. There is no read-then-write, so there is no race —
   a test fires twenty concurrent reservations against a limit of ten and
   asserts exactly ten are granted.
3. **Settle** in the same transaction as the `ai_calls` insert.

A crash between the call and the settle leaves a reservation that counts as
spent until it is swept. That is the deliberate direction to fail in.

## The degradation ladder

A pure function of the fraction of budget used:

| Used | Posture | Effect |
| --- | --- | --- |
| ≥ 70% | warn | Scan depth halved; a banner appears |
| ≥ 85% | degrade | Below-median-value investigations suppressed; degraded models |
| ≥ 95% | critical | High-value decisions only |
| ≥ 100% | stopped | Hard stop; dependent jobs go to `blocked`, not `failed` |

Blocked is not failed. Work held at the stop resumes at period rollover rather
than burning its retries and disappearing into a failed list.

**Manual mode stays fully functional at a hard stop.** Recording evidence,
dedupe, clustering, scoring, allocation and the daily brief need no provider at
all, so a spent budget costs Radar its research, not its usefulness.

## Prices

Model prices are workspace-configured. Radar does not ship guesses about what a
provider charges, and every figure derived from them is labelled *estimated*
because it comes from configured prices rather than from a bill.

Forecast spend is rendered as a range.

## What is recorded

Every call writes an `ai_calls` row: role, model, prompt and schema versions,
token counts, cost, latency, status, attempt, and any injection attempts the
model reported. Calls refused by the budget are recorded too, with
`status: 'blocked_by_budget'` — so the ledger shows what the budget prevented
rather than the work simply vanishing.
