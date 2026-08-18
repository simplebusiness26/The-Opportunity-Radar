# Privacy and data handling

Radar reads public sources and holds a team's own strategic material. Those are
different kinds of data and are treated differently.

## What is stored

**External evidence.** Fetched content, its canonical URL, its origin and the
hashes used for deduplication. Author handles where a source publishes them,
stored as an identity key used only to collapse the same author into one source.
Radar does not build profiles of authors and has no interest in who they are
beyond "is this the same person twice".

**Internal intelligence.** Your capabilities, assets, resources and goals. This
is the most sensitive data in the system: it describes what your team can do and
what it is trying to do. It never leaves the database except inside a prompt you
configured a provider to receive, and never appears in an Execution Brief unless
it is relevant to that brief.

**Decisions and outcomes.** What was decided, by whom, with what rationale, and
what Radar recommended at the time.

## What is not stored

- **Ask Radar questions.** Sanitised, capped and passed to the model; not
  persisted. The endpoint is a `POST` so questions stay out of URLs, server logs
  and browser history.
- **Raw prompts.** The prompt hash is stored for cache identity and fixture
  keying. The assembled text is not kept.
- **Credentials in plaintext.** API keys are encrypted at rest and decrypted
  only for the duration of a call.
- **Anything from a source that asked not to be read.** `robots.txt` is fetched,
  respected, and the decision recorded per fetch.

## What leaves the system

Exactly two things, both under your control:

1. **Prompts to a provider you configured** — evidence text and opportunity
   context, for the roles you ran. With no provider connected, nothing leaves.
2. **Execution Briefs to a delivery target you configured** — and only when you
   hand an opportunity over. With no target configured, the brief is exported
   for you to send yourself.

Radar makes no telemetry calls, has no analytics, and phones nothing home.

## Multi-tenancy

Every domain table carries `workspace_id` and every repository function takes
it as a parameter. There is no ambient workspace, so a cross-workspace read has
to be written deliberately rather than happening by omission — and a route-fuzz
suite asserts it.

There is exactly one deliberately unscoped lookup in the codebase: the execution
feedback endpoint resolves a handoff by its unguessable id, because the external
system reporting an outcome has no way to know which workspace the work belongs
to. It is named `findAcrossWorkspaces` so every use is obvious in review, and
the workspace is taken from the row it finds rather than from anything the
caller said.

## Deletion

Deleting a workspace cascades to everything it owns. Deleting a signal removes
it from the counts it contributed to, and the affected evidence units recompute
their counts from the mentions that remain rather than decrementing — so a
deletion cannot leave a count that no longer matches its evidence.
