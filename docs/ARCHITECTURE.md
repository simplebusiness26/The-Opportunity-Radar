# Architecture

Radar is a hexagonal TypeScript application. The domain is pure, the ports are interfaces, and
every framework, driver and provider lives behind an adapter. Next.js is a delivery adapter, not
the architecture: the worker and the test suites run the same application code with no Next
runtime present.

## The dependency direction

```
app/ + src/web  ->  src/jobs  ->  src/pipeline  ->  src/application  ->  src/domain
                                                          \-> src/ports <- src/adapters
                                        src/composition builds the concrete graph
```

| Layer | Holds | Must not |
| --- | --- | --- |
| `src/domain` | Scoring, dedupe, decay, clustering, leverage, fit, allocation, budget arithmetic, both state machines, SSRF address rules, taxonomies, calibration, retrieval ranking | Touch IO, a clock, a framework, an ORM, or `Date.now()` |
| `src/ports` | Interfaces only: `Clock`, `HttpFetcher`, `AIProvider`, `SecretBox`, `Repositories`, `Transactor` | Import any implementation |
| `src/adapters` | Drizzle repositories, HTTP fetcher, source adapters, AI providers, crypto, clock | Be imported by `src/application` |
| `src/application` | Use-cases over ports: record a signal, score, allocate, run experiments, evaluate triggers | Import an adapter, `next`, or `react` |
| `src/pipeline` | AI gateway, prompt assembly, structured output, projectors, investigation runner, Ask Radar | Call a provider outside the gateway |
| `src/jobs` | Queue runner, scheduler, event router, handlers | — |
| `src/web` + `app/` | Route handlers, pages, components | Contain business rules |
| `src/composition` | The only place that reads configuration and chooses adapters | Be imported by anything below it |

These are enforced twice, on purpose: by `dependency-cruiser` in CI, and by
`tests/unit/architecture.test.ts`, which greps the source directly. A misconfigured linter is a
silent failure; a test that reads the files is not.

## Why the domain is pure

The load-bearing logic of this product is arithmetic over evidence: what the score is, whether two
observations are the same observation, how much a year-old signal is still worth, which of two
opportunities deserves the next fortnight. All of it is exhaustively testable without a database,
a network or a model, and all of it is tested that way.

The corollary is that anything the domain cannot decide is passed in. Time arrives through the
`Clock` port and `Date.now()` is banned outside `src/adapters/clock`, which is what makes decay,
scheduling and lease expiry deterministic under test.

## Database

One PostgreSQL schema, one Drizzle migration set, one driver everywhere.

Development and CI run [PGlite](https://pglite.dev) behind `@electric-sql/pglite-socket`, so it
speaks the real PostgreSQL wire protocol on `127.0.0.1:5433` and `node-postgres` connects to it
exactly as it would to a server. Production points `DATABASE_URL` at a real instance. There is no
branch in the code for which database is in use.

Drizzle rather than Prisma because the product needs `FOR UPDATE SKIP LOCKED`, partial unique
indexes, `pg_trgm` operators, window functions and a transactional outbox — all of which Prisma
would force through `$queryRaw`, which is the worst of both worlds.

### Embeddings without pgvector

PGlite does not bundle the `vector` extension, so embeddings are stored as `bytea` (a packed
`Float32Array`) and cosine similarity is computed in TypeScript over a deterministically blocked
candidate set. This is honest about its limits: it scales to a workspace, not to a corpus, and
approximate-nearest-neighbour indexing is listed in `ROADMAP.md` rather than pretended at.

The default embedder is `lexical-v1`: 512-dimension hashed character n-grams, deterministic, no
credentials. It is labelled as such everywhere it appears so it is never mistaken for a semantic
embedding — it catches spelling variation, not meaning.

## Running it

Two deployment shapes, both first-class:

- **A long-running worker** (`npm run worker`) with an internal scheduler.
- **A tick endpoint** (`POST /api/v1/system/tick`) driven by platform cron, a GitHub Action or a
  systemd timer.

Both call the same `tick()`. Neither is a lesser version of the other. The tick endpoint is also
what makes the end-to-end tests deterministic: they drive it until the queue drains rather than
sleeping.

## Further reading

`docs/DATA_MODEL.md`, `docs/SCORING.md`, `docs/DEDUPLICATION.md`, `docs/JOBS.md`,
`docs/SECURITY.md`, `docs/AI_PIPELINE.md`, `docs/INVESTIGATION.md`, `docs/MEMORY.md`,
`docs/ASK_RADAR.md`, `docs/COST_CONTROL.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`.
