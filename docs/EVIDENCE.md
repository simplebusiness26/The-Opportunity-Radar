# Evidence

Everything Radar concludes rests on evidence, so how evidence is classified,
weighted and aged decides what the system is worth.

## Classes

Where something came from matters more than how often it was repeated. These
tiers are what stop a widely-syndicated opinion piece outweighing one customer
saying what they actually pay.

| Class | Weight | Counts as independent | Half-life |
| --- | --- | --- | --- |
| Direct customer | 1.00 | yes | 540 days |
| Transaction or observed behaviour | 1.00 | yes | 365 days |
| Primary source (company, regulator, dataset) | 0.85 | yes | 540 days |
| Reliable secondary (research citing its own evidence) | 0.65 | yes | — |
| Community (forums, comment threads) | — | yes | — |
| Social | — | yes | — |
| **AI-derived** | — | **no** | — |

AI-derived evidence can never contribute to the independent-source count, to
source diversity, or to confidence. It is a restatement of other evidence, and
counting it would let the system corroborate itself. There is a test that adds
fifty AI-derived mentions and asserts nothing moves.

## Signal types

`pain`, `demand`, `spending`, `workaround`, `labour`, `technology_unlock`,
`cost_collapse`, `competitor_weakness`, `supply_gap`, `trend`, `regulation`,
`distribution`, `behaviour_shift`, `infrastructure`, `capability`, `asset`.

The distinction between `pain` and `spending` is the most load-bearing one in
the product. *Spending* requires an observed amount of money. "We spend six
hours a week on this" is `labour`, not `spending` — and the classifier is
tested on exactly that sentence, because getting it wrong turns effort into
revenue.

## Decay

```
effective = base × 2^(-age / half_life)
```

The half-life is resolved from the signal's own override, then its type, then
its evidence class: technology pricing ages in 45 days, a competitor launch in
90, labour costs in 120, a trend in 60, a behaviour shift in 365, a customer
complaint in 540.

Some evidence does not decay on a clock at all. A regulation, or a recorded
internal capability, changes when something supersedes it — not gradually. Those
are marked event-driven and are only re-weighted when a superseding fact
arrives.

The nightly refresh emits events **only on threshold crossings**, so scores do
not recompute every night for nothing.

## Counter-evidence

Evidence can be attached as arguing *against* a thesis, and it reduces
confidence directly. This is the mechanism by which red-teaming changes the
numbers rather than merely producing prose: an objection that cites evidence
attaches that evidence as counter-evidence, and the score moves.

## Origins and independence

Independence is by `origin_key`: the registrable domain, the upstream domain
when content is syndicated, collapsed further by author identity and declared
affiliation. Platforms where each subdomain is a different author — Substack,
Medium, `github.io` — count separately.

Hand-entered evidence names its source (`Interview with the manager at Bella's`),
and two entries naming the same source count as one. That is what keeps manual
mode honest.
