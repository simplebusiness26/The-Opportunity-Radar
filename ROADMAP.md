# Roadmap

What is deliberately not built, and why. Everything here was considered and set
aside rather than forgotten — a half-built version of any of these would be
worse than its absence, because it would look like coverage.

## Deferred by design

**Approximate-nearest-neighbour vector indexing.** Embeddings are stored as
`bytea` and cosine is computed in TypeScript over a deterministically blocked
candidate set. This scales to a workspace, not a corpus. Adding pgvector and an
HNSW index is a schema change and a repository change, nothing more — but PGlite
does not bundle the extension, and keeping development, CI and production on one
schema is worth more today than the speed.

**A semantic embedder by default.** `lexical-v1` catches spelling and phrasing
variation, not synonymy, and is labelled as such everywhere. Two posts
describing the same problem in entirely different words are counted as two
pieces of evidence. Connecting an embedding provider improves it; pretending the
lexical embedder understands meaning would not.

**OAuth and SSO.** Self-hosted email and password with scrypt and DB-backed
sessions is complete and tested. SSO is a real feature with real edge cases
(just-in-time provisioning, group mapping, session invalidation) and is not
worth a shallow implementation.

**Email and Slack notification delivery.** Alerts are raised, deduplicated,
suppressed within a window, and shown in the interface. Delivering them needs
credentials nobody has supplied and an integration nobody has tested. A notifier
that silently drops alerts is worse than none.

**The GitHub App install flow.** The connector and personal-access-token paths
work. An App needs a registered application, a webhook endpoint and an
installation callback — none of which can be built without an account.

**Real-time collaboration.** Radar is a tool for deciding, not a document
editor. Two people editing the same opportunity simultaneously is not a problem
this product has yet.

**Model fine-tuning.** Every AI role is defined by a prompt and a schema, both
versioned. Fine-tuning would trade that legibility for a marginal gain and make
every conclusion harder to explain.

**Scraping that a site's terms forbid.** Radar reads official APIs and public
feeds, respects `robots.txt`, and rate-limits itself. Implementing questionable
scraping would raise the source count and lower the trustworthiness of every
number derived from it.

**Monte Carlo simulation.** Scenarios are parameter sweeps: change the available
days, change the budget, see the ranking change. A simulation over distributions
nobody has estimated would produce confident-looking numbers from invented
inputs.

**Forecasting beyond trailing means.** Momentum is a trailing measure over
recorded evidence. Anything more would be extrapolation presented as
measurement.

**Load-tested horizontal scale-out.** The queue is designed for it —
`SKIP LOCKED`, leases, per-bucket dedupe keys — and multiple workers are safe.
It has not been load-tested at scale, so no throughput claim is made.

**A native mobile application.** The interface is mobile-first and installable
as a PWA, with an offline shell. A native app would add distribution overhead
and no capability.

## Worth doing next

1. **An embedding provider adapter** behind the existing `AIProvider.embed`
   port. The largest single improvement to dedupe and clustering quality, and
   the plumbing already exists.
2. **The scenario-corpus evaluation suite** — ten corpora scored across six
   behaviours, with thresholds that fail the build. The fixtures are in place;
   the scoring harness is not.
3. **Source health scoring feeding confidence.** Sources already record fetch
   outcomes and injection attempts; letting a persistently unreliable source
   weigh less would close a loop that is currently only observable.
4. **Alert delivery**, once any credential exists to deliver with.
