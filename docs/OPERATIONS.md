# Operating Radar

## The Machine view

`/system` shows what ran, what is waiting, and what is stopping it: queue counts
by status, recent jobs with their outcome detail, schedules with their next fire
time, unprocessed events, and the exact preconditions missing before the next
operating mode.

Nothing on that page is estimated or rounded up. A count of zero is shown as
zero rather than hidden.

## Run it now

Scheduled work can be run immediately from the Machine view, or via
`POST /api/v1/system/run` with `{"kind": "..."}`. Restricted to work that is
safe to trigger by hand — nothing in the list spends money, changes a decision,
or touches a credential:

`events.project`, `triggers.evaluate`, `cluster.assign`, `sources.poll`,
`evidence.refresh_decay`, `alerts.evaluate`, `brief.generate`, `jobs.reap`.

It enqueues without a dedupe key, so asking twice runs it twice. Every job in
the list is idempotent.

## Reading job outcomes

Each job records an event with its detail: what it considered, what it changed,
what it skipped and why. A job that did nothing says what it did not do.

Three statuses mean different things and should be read differently:

- **failed** — something went wrong; it will retry with backoff.
- **blocked** — waiting on the owner for a credential or a budget. It resumes
  when that arrives; it is not an error.
- **cancelled** — asked to stop.

## When something is not happening

1. Check the Machine view's operating mode and its missing preconditions.
2. Check for blocked jobs — they name what they are waiting for.
3. Check the budget posture. At a hard stop, AI work is refused by design and
   everything else keeps working.
4. Check the schedule's next fire time. Most work is debounced by thirty
   seconds and swept on a schedule; "run it now" bypasses the wait.

## Backups

The data worth keeping is the database. `RADAR_SECRET_KEY` is worth keeping
separately: without it, stored credentials cannot be decrypted and every API key
must be re-entered. Nothing else is stateful.

## Upgrading

`npm ci && npm run db:migrate && npm run build`. Migrations are forward-only and
additive; none of them drop a column that holds evidence.
