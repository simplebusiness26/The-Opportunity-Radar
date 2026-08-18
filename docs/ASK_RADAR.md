# Ask Radar

Ask Radar answers questions about what this workspace has recorded. It is not a chatbot with a
view on the world, and the difference is enforced rather than stated.

## The rule

> Cite a record, or say you cannot answer.

Three mechanisms hold it, in order of how early they act:

1. **Retrieval only sees recorded rows.** `buildCorpus` reads opportunities, clusters, evidence
   units, investigation outputs, decisions, experiments, execution history, capabilities and
   assets from this workspace. There is no external retrieval and no route by which anything else
   can reach the prompt.

2. **Grounding is assessed before any model is called.** `assessGrounding` refuses when nothing
   was retrieved, and refuses when the closest records do not actually address the question — a
   question that shares common words with everything is exactly when a fluent answer would be
   least justified. An ungrounded question therefore costs nothing and returns an honest answer.

3. **Every claim is checked against what was supplied.** The schema requires the answer to be
   broken into individual statements, each citing record ids. A statement citing an id that was
   never supplied is discarded. If nothing survives, the result becomes a *refusal*, not a shorter
   answer — a half-cited answer is the failure mode this exists to prevent.

The model is also allowed to decline: `answerable: false` with a specific `refusalReason` is passed
through rather than overridden.

## Retrieval

Ranking is `0.65 × keyword overlap + 0.35 × lexical cosine`. Keyword overlap is weighted higher
deliberately: the embedder is lexical, not semantic, so treating its similarity as understanding
would be a claim it cannot support.

Question words that would match everything (`what`, `about`, `would`, …) are dropped before
matching.

## Without an AI provider

Ask Radar still works, as search. It returns the ranked records with `mode: 'search_only'` and says
plainly that no answer was composed and why. The records are genuinely useful; they are simply not
presented as an answer.

## What is not stored

The question is not persisted. It is sanitised, capped at 500 characters, and passed to the model
as an untrusted block like every other input — it reaches the request and nothing else. The route
is a `POST` so questions stay out of URLs, server logs and browser history.

## Injection

The question and every retrieved record are untrusted content, wrapped in the per-call nonce by
the prompt assembler. Evidence bodies come from the internet; treating them as instructions is
exactly the attack the assembler exists to prevent. See `docs/SECURITY.md`.
