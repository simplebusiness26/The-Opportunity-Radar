# Operating modes

The mode is **derived** from what is actually connected, never declared. There
is no setting that says "autonomous"; there is a fact about how many providers,
sources and schedules are enabled, and the mode follows from it.

| Mode | Requires | What Radar does |
| --- | --- | --- |
| **MANUAL** | nothing | Evidence recorded by hand, deduplicated, clustered, scored, allocated. The daily brief, the decision log, experiments and the execution brief all work. |
| **AI_ASSISTED** | a provider | Adds investigation, the red team, uncertainty analysis, validation design, and Ask Radar answering in prose. |
| **AUTONOMOUS** | a provider, a source, a schedule | Radar collects, groups, investigates and alerts on its own, and tells you what changed. |

The Machine view shows the derivation and names the exact missing
preconditions — not "connect an integration to unlock", but *which* one and what
becomes possible.

## What manual mode really means

Not a trial, not a stub, not a degraded state. Every load-bearing judgement in
the product is arithmetic over recorded evidence, and none of it needs a model:

- the three-level dedupe cascade and the independence counts
- the twenty-one scoring dimensions and confidence, with its caps
- decay and freshness
- capability matching, build leverage and fit
- allocation, including `NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION`
- validation plans, experiments and their verdicts against agreed thresholds
- re-evaluation triggers and reopening
- the Execution Brief, its readiness verdict, and the handoff
- calibration from execution history

All five acceptance tests run with no AI provider connected. That is the claim,
and it is checked in CI rather than asserted here.

## What a provider adds

Analysis, not arithmetic: reading a corpus and saying what is in it, arguing
the case against, separating assumptions from findings, designing a test,
answering a question in prose with citations.

Every AI-dependent feature declares what it requires and renders a specific
"unavailable because X" state. There is no fake value and no eternal spinner —
an end-to-end test opens an opportunity with no provider connected and asserts
the Investigate control is disabled and says why.

## Degradation is not mode change

A spent budget does not drop the mode. It refuses AI work — visibly, with the
posture shown in a banner — while everything else continues. See
`docs/COST_CONTROL.md`.
