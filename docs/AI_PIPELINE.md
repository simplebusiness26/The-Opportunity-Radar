# The AI pipeline

Radar works completely without an AI provider. What a provider adds is
investigation, red-teaming and Ask Radar — analysis, not arithmetic. Everything
load-bearing (dedupe, decay, scoring, allocation, the daily brief) is
deterministic code and stays that way.

## Modes are derived, not configured

- **MANUAL** — no provider. A human runs the whole loop by hand.
- **AI_ASSISTED** — a provider is connected.
- **AUTONOMOUS** — a provider, a source, and a schedule.

The Machine view shows the derivation and the exact missing preconditions. Every
AI-dependent feature declares what it requires and renders a specific
"unavailable because X" state — never a fake value, never an eternal spinner.

## One door

`callAi` is the only path to a provider. It routes by role, governs against the
budget, reserves, calls, settles and writes the ledger. Fallback happens only on
a *transient* provider failure: a rejected key or an unknown model will fail
identically on the second provider, so retrying there just doubles the latency
before reporting the same problem.

## Structured output

One zod schema per role, keyed `schema_key@version`, mapped to provider-native
structured output where the provider supports it — native enforcement is worth
much more than asking politely for JSON.

The parse ladder allows **exactly one** repair attempt, and the repair is shown
only the schema, the errors and the malformed output — never the untrusted
content again. That is cheaper and removes a second injection surface. Two
failures produce a typed error and **nothing is written**: a half-parsed
analysis silently entering the database is worse than an obvious failure,
because it becomes evidence nobody can trace.

## Projection

Schema validation proves the output has the right *shape*. It says nothing about
whether the contents are true, in range, or referring to things that exist.
Projection is where that is enforced, and it is why a model cannot corrupt the
database however badly it behaves:

- numbers are clamped to their declared range rather than trusted;
- enum values outside the known set are dropped, not stored;
- **every citation must name evidence that was actually supplied** — a
  hallucinated citation is discarded and counted, and a claim whose every
  citation was invented is dropped outright.

Everything dropped is counted and surfaced, so a model that habitually invents
citations becomes visible rather than quietly shaping the scores.

## Zero-credential operation

The default embedder is `lexical-v1`: 512-dimension hashed character n-grams,
deterministic, no network. It makes the whole pipeline runnable and testable
with no provider, and it is labelled everywhere it appears so it is never
mistaken for a semantic embedding.

For tests, `FixtureProvider` replays recorded responses keyed by prompt and
schema version. A missing recording is a loud failure naming the exact key,
never a silently invented answer — a fixture suite that quietly fabricates
responses would test nothing while appearing to test everything.
