# Working on Radar

## Before you start

```bash
npm install
cp .env.example .env       # fill RADAR_SECRET_KEY; the file says how
./scripts/db-restart.sh    # embedded PostgreSQL on 127.0.0.1:5433
npm run db:migrate
npm run dev
```

`npm run db:seed` gives you something to look at. Everything it writes is
flagged DEMO.

## The rules that are enforced, not suggested

Each of these fails the build, and each exists because breaking it once cost
something:

- **`src/domain` is pure.** No IO, no framework, no ORM, no clock. Checked by
  `dependency-cruiser` and by a test that greps the source, because a
  misconfigured linter is a silent failure.
- **`src/application` never imports an adapter.** Dependencies arrive through
  ports from the composition root.
- **`Date.now()` and `new Date()` are banned** outside `src/adapters/clock`.
  Time is injected. This is what makes decay, leases, scheduling and
  re-evaluation triggers testable — and mixing the injected clock with database
  `now()` defaults has already produced one bug where a trigger could never
  fire.
- **`drizzle-orm` and `pg` live only in `src/adapters/db`.**
- **`next` and `react` live only in `app/` and `src/web`.**
- **Nothing calls a provider except the AI gateway**, and nothing reaches the
  network except `SafeFetcher`.
- **No `Promise.all` inside a transaction.** They share one connection, and two
  queries in flight desynchronise the protocol. There is a test that reads the
  braces.

## Adding things

**A scoring dimension.** Add it to the registry with a `compute` that returns
`insufficient_evidence` when nothing established it. Never return zero for
missing data. Add a unit test for both the measured and the unmeasured case.

**A source adapter.** Implement the adapter interface, add a recorded fixture,
and it inherits the shared contract test. Do not add an outbound call; use the
fetcher you are given.

**An AI role.** A prompt, a zod schema extending `baseOutput`, a projector, and
a stated termination condition. If the role can assert something about the
world, its schema must require citations and its projector must drop claims that
cite nothing.

**A job.** Register it, give it a timeout, and declare what it requires. If it
needs something the owner has not connected, throw `JobBlocked` rather than
failing — blocked work resumes; failed work burns its retries and disappears.

**A migration.** `npm run db:generate`, then rename the file to say what it
does. Migrations are forward-only and additive.

## Writing tests

Prefer the level that can actually fail for the right reason. Domain logic gets
a unit test; anything involving ordering, concurrency or SQL gets an integration
test against the real wire protocol; anything a person would notice gets an
end-to-end test.

Do not sleep. The clock is injected and the tick endpoint is drivable; a test
that sleeps is a test that will be flaky on a slower machine.

Assert on the specific outcome. `getByRole('alert')` once passed on the error
alert and hid a real failure for an afternoon.

## Writing copy

The interface speaks plainly and never overstates. If a number is estimated, say
estimated. If something could not be established, say so where the number would
have gone. If a feature needs a credential, say which one and what it enables.

Read `docs/PRODUCT.md` before writing anything a user will see.
