# Data model

One PostgreSQL schema, one Drizzle migration set, one driver. Every domain table
carries `workspace_id`, and tenancy is a parameter on every repository function
rather than an ambient value.

## The rule for JSON versus columns

Stated once, applied everywhere:

- **Relational** if it is filtered, sorted, joined, counted, permission-scoped,
  foreign-key referenced, or numerically feeds a score.
- **JSONB** for verbatim external payloads, validated heterogeneous AI outputs,
  configuration blobs and explanation detail.
- **Never JSONB** for anything a score depends on, a test asserts on, or the
  interface filters by.

## The groups

**Tenancy and access.** `orgs`, `workspaces`, `users`, `memberships`,
`sessions`, `audit_log`, `secrets`. Workspace settings are JSONB because nothing
queries inside them.

**Evidence.** `signals` (a raw observation: title, body, canonical URL, content
hash, simhash, origin key, author identity, monetary evidence, packed
embedding), `signal_processing_events` (every dedupe decision with its reason
code), `entities`, `signal_entities`, `evidence_units` (a distinct claim),
`evidence_mentions` (which signals support which unit, with the dedupe reason
that grouped them).

The three headline counts are derived from these tables, never incremented, so
they cannot drift.

**Problems and opportunities.** `clusters`, `cluster_members`, `opportunities`,
`opportunity_state_transitions`, `opportunity_evidence` (stanced: for or
against), `opportunity_capability_requirements`, `opportunity_relationships`.

**Scoring.** `score_weight_profiles`, `scores` (with `inputs_digest` and the
frozen `inputs_snapshot`), `score_deltas` (with `top_drivers`), `decision_log`.
A score can always be traced to the exact inputs it was computed from.

**Internal intelligence.** `ig_nodes` and `ig_edges` with typed satellites:
`capabilities`, `assets`, `resources`, `goals`, plus `capability_taxonomy` and
`execution_history`.

**Investigation.** `investigations` (one run of one role, with its termination
reason and spend), `investigation_outputs` (payload plus the projection report),
`uncertainty_items`, `validation_plans`, `experiments`,
`experiment_transitions`, `experiment_results`, `experiment_contacts`,
`reevaluation_triggers`.

**AI and cost.** `ai_providers`, `ai_models`, `ai_role_routes`, `ai_calls` (the
ledger), `budgets`, `budget_ledger`, `budget_reservations`.

**Sources.** `sources`, `source_runs`, `fetch_records`.

**Operations.** `jobs`, `job_events`, `schedules`, `domain_events` (the
transactional outbox), `alerts`, `daily_briefs`, `visits`, `run_stats`.

**Execution boundary.** `handoffs`, holding the snapshotted brief as both JSONB
and Markdown.

## Indexes that matter

- `jobs_dedupe_pending_key` — partial unique on `(workspace_id, dedupe_key)`
  for pending statuses only. This is what makes enqueue idempotent.
- `jobs_claim_idx` on `(status, run_at, priority)` — the claim path.
- `experiment_results_metric` — unique on `(experiment_id, metric_key)`, so a
  metric cannot be recorded twice with different values.
- `handoffs_external_ref_key` — unique per workspace, for correlating feedback.
- `opportunity_relationships_unique` on `(from, to, kind)`.

## Timestamps

Every timestamp a decision depends on comes from the injected `Clock`, not from
a database default. Mixing the two is not a style preference: a trigger armed
by the clock and compared against a database default silently never fires, which
is a bug this codebase has already had once.

The exception is bookkeeping columns nothing compares against
(`created_at`/`updated_at` on reference tables), which keep `defaultNow()`.
