# Deployment

Two shapes, both first-class. Choose by what your platform can host, not by
which is "proper".

## A. Long-running process (VPS, Docker, systemd)

```bash
npm ci
npm run build
DATABASE_URL=postgres://… npm run db:migrate
DATABASE_URL=postgres://… npm run start      # the web app
DATABASE_URL=postgres://… npm run worker     # the machine
```

The worker holds an internal scheduler and drains the queue continuously. Run
more than one if you need to; the queue is safe under concurrency by design
(`FOR UPDATE SKIP LOCKED`, leases, a reaper, and per-bucket dedupe keys).

## B. Serverless with an external scheduler (Vercel, GitHub Actions, cron)

Deploy the app, set `RADAR_TICK_TOKEN`, and have your scheduler call:

```
POST https://your-host/api/v1/system/tick
Authorization: Bearer $RADAR_TICK_TOKEN
```

every few minutes. Each call runs one scheduler pass and drains jobs under a
wall-clock budget, so it returns rather than being killed mid-job. With no token
set the endpoint is disabled outright.

## Database

Point `DATABASE_URL` at PostgreSQL 14 or later and run `npm run db:migrate`.
Nothing else changes: development, CI and production share one driver, one
schema and one migration set. The embedded PGlite server is a development
convenience, not a different code path.

Extensions used: `pgcrypto`, `pg_trgm`, `citext`, `fuzzystrmatch`. `pgvector`
is **not** required — embeddings are stored as `bytea` and compared in
TypeScript.

## Environment

`.env.example` documents every variable and holds no secrets. The ones that
matter:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection |
| `RADAR_SECRET_KEY` | yes | Encrypts stored credentials. Losing it means re-entering every API key |
| `RADAR_SINGLE_OWNER` | no | When true, only the first account may be created |
| `RADAR_TICK_TOKEN` | for shape B | Bearer token for the tick endpoint |
| `RADAR_FEEDBACK_TOKEN` | no | Bearer token for execution feedback |
| `DATABASE_POOL_MAX` | no | Leave at 1 against the embedded server |

No AI or source credentials are needed to run Radar. See
`CONNECTIONS_REQUIRED.md` for what each optional connection adds.

## Before going live

1. Set `RADAR_SECRET_KEY` to a fresh 32-byte value and back it up.
2. Set `RADAR_SINGLE_OWNER=true` unless you are inviting people.
3. Put it behind TLS. Session cookies are `Secure` in production.
4. Set a monthly AI budget before connecting a provider. The ladder degrades
   gracefully, but only against a limit that exists.
5. Run `npm run check` against your target database.
