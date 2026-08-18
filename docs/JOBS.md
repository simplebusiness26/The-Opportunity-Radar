# Background work

Radar runs itself through a database-backed queue. There are no in-process
timers holding state, because a timeout that only exists in memory does not
survive the process dying.

## Claiming

`FOR UPDATE SKIP LOCKED`, so multiple workers never claim the same job and none
of them blocks waiting for another. Each claim takes a lease; a reaper reclaims
work whose worker stopped reporting. Handlers heartbeat to extend the lease and
checkpoint to persist partial progress, so long work is resumable and
cancellable at a safe boundary.

Retries use exponential backoff with jitter. Three outcomes are distinguished
and they mean different things:

- **failed** — it went wrong and will be retried, then given up on.
- **blocked** — a precondition the owner has not supplied. Held, not failed;
  resumes when the credential or budget arrives.
- **cancelled** — asked to stop, honoured at the next checkpoint.

## Idempotency

A partial unique index on `(workspace_id, dedupe_key)` for pending work means an
enqueue that duplicates in-flight work is a no-op rather than a second job.

The scheduler enqueues with `dedupe_key = key + ':' + due_bucket_iso`, which
gives exactly-once-per-bucket under multiple workers, double ticks and clock
skew — with no distributed lock and no leader election.

## The outbox

Domain events are appended in the same transaction as the write they describe,
so the outbox can never claim something happened that did not. They are consumed
in `sequence` order and routed by a static table, so the whole recomputation
graph is legible in one place rather than scattered across handlers.

Debounce is mandatory. A scan producing five hundred signals must recompute each
affected opportunity once, not five hundred times, so routes name the payload
field that collapses a burst. A `causation_depth` cap turns a self-causing chain
into a bounded, visible failure instead of an infinite one.

A test asserts every route points at a job that exists, and that routes carrying
bursts declare a debounce key.

## Two ways to run it

- `npm run worker` — a long-running process with an internal scheduler.
- `POST /api/v1/system/tick` — one scheduler pass plus a drain under a
  wall-clock budget, driven by platform cron, a GitHub Action or a systemd
  timer. Bearer-token authenticated; with no token configured the endpoint is
  disabled outright rather than left open.

Both call the same `tick()`. The tick endpoint is also what makes the
end-to-end tests deterministic: they drive it until the queue drains, with a
maximum-iteration assertion, rather than sleeping.
