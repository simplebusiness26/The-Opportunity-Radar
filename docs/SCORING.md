# Scoring

Every number Radar shows is arithmetic over recorded evidence. Nothing is a model's opinion, and
nothing is a placeholder dressed as a measurement.

## Shape

Twenty-one dimensions feed eight composites: attractiveness, fit, leverage, timing, validation
efficiency, strategic value, execution risk, and confidence.

Each dimension is a pure function of the frozen `ScoringInput` snapshot, and each returns one of:

- `ok` with a raw value and a normalised 0–1 score, plus an explanation naming what produced it;
- `insufficient_evidence`, with a reason.

## Confidence is not a weight

Confidence is computed separately and is never folded into attractiveness. This is enforced by a
registry-level unit test, because the conflation is the single most common way a scoring system
becomes untrustworthy: it lets a well-evidenced mediocre idea and a barely-evidenced exciting one
produce the same headline number.

Confidence has its own factors — independent sources, evidence quality, source diversity, freshness,
counter-evidence, coverage — and each is shown with its contribution.

## Missing data is missing, not zero

A dimension nothing has established is `insufficient_evidence`. Its weight is redistributed across
the dimensions that *were* measured, and coverage drops, which lowers confidence.

Scoring it zero would be a lie in the arithmetic: "we have no evidence people will pay" and "we
have evidence people will not pay" are opposite findings, and a zero cannot tell them apart. This
distinction is what makes the *kill an attractive idea* acceptance test fall out of the model
rather than being special-cased.

## The hard cap

Zero non-AI-derived independent sources caps confidence at 0.15. AI-derived evidence never
contributes to independence, so adding fifty model-written observations moves neither the
independent-source count nor confidence. There is a test that adds them and asserts nothing moves.

## Calibration

Once eight or more completed projects have been recorded, scoring receives this team's own
build-estimate ratio and confidence bias. Below that the domain refuses to produce a ratio and says
how many more are needed. See `docs/MEMORY.md`.

## Idempotence and history

`inputsDigest` is the SHA-256 of the canonicalised input, so recomputing with identical inputs is
skipped rather than writing a duplicate row. That is what lets the event-driven pipeline fire
freely without inflating history.

When a score does change, `scoreDeltas` records what moved and `topDrivers` names the dimensions
that moved most, computed by diffing dimension contributions. **The daily brief's "what changed"
needs no model at all** — it is a query.

## The three counts

Every surface that shows evidence shows the triple:

```
412 mentions · 37 unique evidence · 9 independent sources
```

This is the product's credibility claim, and it is why `docs/DEDUPLICATION.md` exists.
