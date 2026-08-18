# Investigation and the red team

Six roles, run in a fixed order under deterministic orchestration. No model
decides what happens next; the depth policy does, from stored counts.

| Role | Establishes | Stops when |
| --- | --- | --- |
| Market | Who has the problem and how they cope today | The customer and problem are stated, or the evidence is too thin to state either |
| Competitors | What already exists, including free alternatives | Existing solutions and the gap between them are described |
| Demand | Whether money already moves | Willingness to pay is assessed, including concluding it cannot be |
| Uncertainty | What is known, assumed and unknown | The critical unknowns are identified and costed |
| Red team | The strongest case against | A verdict is reached with its reasoning |
| Validation | The cheapest credible test of the riskiest assumption | One experiment with stated thresholds is designed |

Each role has one responsibility, one output schema and one stated termination
condition, recorded on the run. A role that cannot say why it finished will keep
spending money.

## The depth gate

`decideDepth` decides what has earned paid research. Its refusals matter more
than its approvals — most candidates should stop early:

- A fatal red-team verdict ends it.
- Zero independent sources: investigating would mean researching one party's
  opinion.
- Under 3 unique evidence or 2 independent sources: collect more first.
- Preliminary score under 45: not worth paying to research.
- Score under 55: not worth the expensive red-team pass.
- Confidence under 0.35: too low to aim an experiment properly.

Each refusal is recorded as a terminated run with its reason and what is needed,
so the interface can say what is missing rather than showing nothing happening.

## The red team

It runs on the most expensive model tier and is the one role never dropped when
money is short — skipping the attempt to kill an idea while continuing to
research it is the worst possible way to save money.

Its verdict is held to a standard the other roles are not: **"fatal" survives
only if an objection cites evidence that was actually supplied.** Otherwise the
reasoning is kept, the objection is marked unsupported, and the verdict is
downgraded to `serious_but_testable` with the downgrade recorded and shown.

Evidence the red team relies on is attached to the opportunity as
counter-evidence, so a rejection names rows a person can read rather than a
model's summary of them.

## Radar recommends; it does not decide

The runner can recommend rejection. It cannot take it. A background job that
concludes an idea is dead raises an alert and moves the opportunity back to
*watching*; killing it is the owner's decision and is recorded in the decision
log when they make it.

## What crosses between stages

Later roles see earlier conclusions as **untrusted blocks**, never as trusted
prompt variables — they are ultimately derived from fetched text. Their ids are
stripped from citations before projection, so a claim resting only on an earlier
conclusion arrives uncited and is dropped. See `docs/SECURITY.md`.

## Experiments

Thresholds are fixed when the plan is written and are not editable afterwards,
so the verdict is a comparison rather than an interpretation of a disappointing
result. The lifecycle is a state machine: results can only be recorded while
running or blocked, and a completed experiment cannot be reopened — design a new
one rather than editing the record of what happened.

An inconclusive result moves confidence by zero. Rewarding activity over
evidence is exactly what this product exists not to do.
