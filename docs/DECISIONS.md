# Decisions

The choices that shaped the build, and what each one cost.

## PGlite over the wire, not in-process

**Chosen:** run PGlite behind `@electric-sql/pglite-socket` so it speaks the
real PostgreSQL wire protocol, and connect with `node-postgres` everywhere.

**Rejected:** PGlite in-process for development. It holds an exclusive data-dir
lock, so the dev server, the worker, vitest and drizzle-kit would contend for
it, and the driver path would differ from production.

**Cost:** one more process to start. **Bought:** development, CI and production
run the same driver, the same schema and the same migrations, with no branch in
the code for which database is in use.

## Drizzle over Prisma

**Chosen:** Drizzle. The product needs `FOR UPDATE SKIP LOCKED`, partial unique
indexes, `pg_trgm` operators, window functions and a transactional outbox.

**Cost:** explicit joins, hidden behind repository functions that return DTOs.
**Bought:** none of the above needs an escape hatch. Prisma would have forced
`$queryRaw` for all of them, which is the worst of both worlds.

## `bytea` embeddings, cosine in TypeScript

**Chosen:** store packed `Float32Array` and compare in TypeScript over a
deterministically blocked candidate set.

**Forced by:** PGlite does not bundle `vector`.

**Cost:** it scales to a workspace, not a corpus. **Bought:** one schema
everywhere. ANN indexing is in `ROADMAP.md` rather than half-built.

## A lexical embedder by default

**Chosen:** 512-dimension hashed character n-grams, deterministic, no
credentials, labelled `lexical-v1` in every interface that shows it.

**Cost:** it catches spelling variation, not synonymy, and `docs/DEDUPLICATION.md`
says so plainly. **Bought:** the entire pipeline runs and is testable with no
provider connected, which is what makes manual mode real rather than a
degraded stub.

## Confidence separate from attractiveness

**Chosen:** compute them independently, enforce the separation with a
registry-level test.

**Rejected:** a single "opportunity score", which every competitor ships.

**Cost:** two numbers to explain instead of one. **Bought:** the difference
between a well-evidenced ordinary idea and a barely-evidenced exciting one is
visible, which is the difference that matters.

## Radar recommends; a person decides

**Chosen:** background work may ingest, group, score and alert. It may never
reject an opportunity, commit resources, change a budget or touch a credential.

**Cost:** the system cannot run entirely unattended, and never claims to.
**Bought:** a compromised source cannot escalate through a job, and no
irreversible decision is ever taken by something that cannot be held to account.

## The injected clock

**Chosen:** all time through a `Clock` port; `Date.now()` banned outside its
adapter by the linter and by a test.

**Cost:** a parameter threaded through most of the application layer.
**Bought:** decay, scheduling, leases and re-evaluation triggers are all
deterministic under test.

This one earned its keep twice over: mixing the injected clock with database
`now()` defaults produced a trigger that could never fire, and a job claim that
read raw SQL columns produced jobs whose `workspaceId` was undefined — every
handler silently doing nothing and reporting success. Both were found by
building the acceptance tests rather than by reading the code.

## Two deployment shapes, both first-class

**Chosen:** a long-running worker *and* a token-authenticated tick endpoint,
calling the same `tick()`.

**Cost:** a second entry point to keep working. **Bought:** Radar runs on a VPS
or on a platform that cannot keep a process alive, and the tick endpoint is
also what makes the end-to-end tests deterministic without sleeping.
