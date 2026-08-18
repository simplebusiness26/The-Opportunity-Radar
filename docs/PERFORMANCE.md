# Performance, and what is not claimed

No throughput figure appears in this repository, because none has been measured
under load. What follows is the shape of the work and where it would bind first.

## Where the time goes

**Ingestion** is network-bound and rate-limited on purpose. Each source runs one
scan at a time, however often polling fires, because a source that answers
politely is worth more than a source that answers quickly and then blocks you.

**Deduplication** is the most expensive local operation. The cascade is
cheapest-first — canonical URL, then content hash, then source item id, then
simhash, then embedding — so the expensive comparison only runs for candidates
that survived the cheap ones. Candidates are narrowed by blocking keys and a
time window rather than scanned wholesale.

**Cosine similarity runs in TypeScript** over packed `Float32Array` vectors. At
workspace scale — thousands of evidence units — this is comfortably fast. At
corpus scale it would not be, and that is the first thing that would need
pgvector and an ANN index. See `ROADMAP.md`.

**Scoring** is pure arithmetic over a frozen snapshot and is idempotent: an
identical `inputs_digest` is skipped rather than recomputed, which is what lets
the event-driven pipeline fire freely.

**AI calls** dominate wall-clock and cost when a provider is connected, which is
why the depth gate exists: most candidates should never reach a paid role.

## Where it would bind first

1. **The single database connection in development.** PGlite multiplexes onto
   one backend, so `DATABASE_POOL_MAX` is 1 there. Against real PostgreSQL,
   raise it.
2. **Dedupe candidate sets**, if a workspace accumulated hundreds of thousands
   of signals without archiving.
3. **The event outbox**, if a single scan produced an unusually large burst.
   Debouncing collapses a burst into one job per subject, which is what stops
   five hundred signals becoming five hundred recomputations.

## Scaling out

The queue is designed for multiple workers — `FOR UPDATE SKIP LOCKED`, leases, a
reaper, and per-bucket dedupe keys — and running several is safe by
construction. It has not been load-tested, so that is a design property, not a
benchmark.

## What would be measured first

If this mattered tomorrow: dedupe candidate-set size against corpus size,
cluster assignment time as evidence grows, and the wall-clock of one tick under
a realistic backlog. None of those numbers exist yet, and inventing them would
be exactly the kind of confident fabrication this product is built to avoid.
