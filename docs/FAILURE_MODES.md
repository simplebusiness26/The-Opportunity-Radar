# How this could still be wrong

A product that claims to be honest about evidence should be honest about
itself. These are the ways Radar can mislead, what is done about each, and what
remains.

## It can miss evidence that is genuinely there

The default embedder is lexical. Two posts describing the same problem in
entirely different words are counted as two pieces of evidence rather than one,
and — worse in the other direction — a problem discussed only in vocabulary
Radar has never seen will not cluster with anything.

**Mitigated by:** entity extraction and URL canonicalisation catching many
cases; the embedder labelled `lexical-v1` wherever a vector is shown.
**Remaining:** connect an embedding provider. Listed first in `ROADMAP.md`.

## Its independence count can be fooled

Origin keys collapse by registrable domain, upstream domain when syndicated,
author identity and declared affiliation. A determined actor posting the same
claim under four identities on four domains would read as four independent
sources.

**Mitigated by:** evidence class weighting, so anonymous community posts are
worth far less than a named customer or an observed transaction; syndication
detection; hand-entered evidence naming its source.
**Remaining:** nothing detects coordinated inauthenticity, and nothing claims to.

## Its estimates are only as good as what it was told

Build leverage is computed from capabilities somebody typed in. An optimistic
self-assessment produces an optimistic estimate.

**Mitigated by:** maturity, evidence strength and reuse readiness recorded per
capability; estimates rendered as ranges; calibration comparing predictions
against outcomes once there are eight of them.
**Remaining:** until then, the estimates are unadjusted and Radar says so.

## A model can be confidently wrong inside a role

Projection guarantees that a claim cites supplied evidence. It cannot guarantee
the claim is a fair reading of that evidence.

**Mitigated by:** the red team being run on the most capable tier and never
dropped when money is short; fatal verdicts requiring a cited objection; every
finding shown with its citations so a person can check it in one click;
the projection report shown when anything was corrected.
**Remaining:** a plausible misreading of real evidence will survive. This is why
nothing a model produces can reject an opportunity or commit resources.

## The scoring weights are a judgement

Twenty-one dimensions and their weights encode a view about what makes an
opportunity good. That view is arguable.

**Mitigated by:** weights are workspace-configurable; every dimension shows its
contribution and its explanation; attractiveness and confidence never mix.
**Remaining:** the defaults are ours, not a law of nature.

## The queue can hold work invisibly

Blocked jobs wait for a credential rather than failing. A workspace could sit
with work held indefinitely and look idle.

**Mitigated by:** blocked jobs are counted separately on the Machine view and
name what they are waiting for; the operating mode states its missing
preconditions.
**Remaining:** nobody is paged. There is no alert delivery — see `ROADMAP.md`.

## Costs are estimated, not billed

Every cost figure is derived from workspace-configured prices, not from a
provider's invoice.

**Mitigated by:** labelled *estimated* everywhere it appears; the budget
reservation is atomic and fails closed; the ledger records what the budget
refused as well as what it spent.
**Remaining:** if the configured prices are wrong, the ledger is wrong in the
same direction.

## The evaluation suite does not yet score a live model

The corpora, the scorers and the harness exist and run. The model-dependent half
is reported as *not scored*.

**Mitigated by:** a test that asserts this, so the green stage cannot be read as
covering more than it does.
**Remaining:** wire the live path when a provider is available.
